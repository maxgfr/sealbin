/**
 * Minimal in-memory NIP-01 relay for tests (vitest integration and Playwright e2e).
 * Supports: EVENT (signature check, NIP-33 addressable replacement, NIP-40 expiration),
 * REQ/CLOSE with EOSE, NIP-09 deletions by `e` and `a` tags (author must match; `a` only removes
 * events up to the deletion's created_at). Addressable replacement keeps the newest event.
 *
 * With `maxMessageLength`, EVENT messages longer than that many bytes get `OK false`, like
 * public relays (NIP-11 `limitation.max_message_length`).
 *
 *   const relay = await startTestRelay();      // ws://127.0.0.1:<random port>
 *   ...; await relay.close();
 */
import type { AddressInfo } from "node:net";
import { type Filter, matchFilters } from "nostr-tools/filter";
import { type Event, verifyEvent } from "nostr-tools/pure";
import { type WebSocket, WebSocketServer } from "ws";

export interface TestRelay {
  url: string;
  /** Live stored events (excluding deleted/expired ones). */
  events(): Event[];
  close(): Promise<void>;
}

function tag(e: Event, name: string): string | undefined {
  return e.tags.find((t) => t[0] === name)?.[1];
}

function isExpired(e: Event, nowSec: number): boolean {
  const exp = tag(e, "expiration");
  return exp !== undefined && Number(exp) <= nowSec;
}

export interface TestRelayOptions {
  /** Max bytes of one client message; larger EVENT messages are refused. */
  maxMessageLength?: number;
}

export async function startTestRelay(port = 0, opts: TestRelayOptions = {}): Promise<TestRelay> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port });
  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
  let store: Event[] = [];
  const subs = new Map<WebSocket, Map<string, Filter[]>>();
  const now = () => Math.floor(Date.now() / 1000);
  const live = () => store.filter((e) => !isExpired(e, now()));

  const send = (ws: WebSocket, msg: unknown[]) => ws.send(JSON.stringify(msg));

  function accept(e: Event): [boolean, string] {
    if (!verifyEvent(e)) return [false, "invalid: bad signature"];
    if (isExpired(e, now())) return [false, "invalid: event is expired"];
    if (e.kind === 5) {
      for (const t of e.tags) {
        if (t[0] === "e") store = store.filter((x) => !(x.id === t[1] && x.pubkey === e.pubkey));
        if (t[0] === "a") {
          const [kind, pubkey, d] = (t[1] ?? "").split(":");
          if (pubkey !== e.pubkey) continue;
          store = store.filter(
            (x) =>
              !(
                String(x.kind) === kind &&
                x.pubkey === pubkey &&
                (tag(x, "d") ?? "") === (d ?? "") &&
                x.created_at <= e.created_at
              ),
          );
        }
      }
    } else if (e.kind >= 30000 && e.kind < 40000) {
      const d = tag(e, "d") ?? "";
      const same = (x: Event) =>
        x.kind === e.kind && x.pubkey === e.pubkey && (tag(x, "d") ?? "") === d;
      if (store.some((x) => same(x) && x.created_at > e.created_at))
        return [true, "duplicate: have a newer event"];
      store = store.filter((x) => !same(x));
    }
    store.push(e);
    return [true, ""];
  }

  wss.on("connection", (ws) => {
    subs.set(ws, new Map());
    ws.on("close", () => subs.delete(ws));
    ws.on("message", (data) => {
      const text = String(data);
      let msg: unknown;
      try {
        msg = JSON.parse(text);
      } catch (err) {
        send(ws, ["NOTICE", `invalid: ${String(err)}`]);
        return;
      }
      if (!Array.isArray(msg)) return send(ws, ["NOTICE", "invalid: not an array"]);
      const [type, ...rest] = msg as [unknown, ...unknown[]];
      if (type === "EVENT") {
        const e = rest[0] as Event;
        const max = opts.maxMessageLength;
        const [ok, reason] =
          max !== undefined && Buffer.byteLength(text) > max
            ? [false, `invalid: message too large (limit ${max} bytes)`]
            : accept(e);
        send(ws, ["OK", e.id, ok, reason]);
        if (ok) {
          for (const [client, clientSubs] of subs) {
            for (const [id, filters] of clientSubs)
              if (matchFilters(filters, e)) send(client, ["EVENT", id, e]);
          }
        }
      } else if (type === "REQ") {
        const id = String(rest[0]);
        const filters = rest.slice(1) as Filter[];
        subs.get(ws)?.set(id, filters);
        for (const e of live()) if (matchFilters(filters, e)) send(ws, ["EVENT", id, e]);
        send(ws, ["EOSE", id]);
      } else if (type === "CLOSE") {
        subs.get(ws)?.delete(String(rest[0]));
      }
    });
  });

  const { port: actual } = wss.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${actual}`,
    events: live,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const client of wss.clients) client.terminate();
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
