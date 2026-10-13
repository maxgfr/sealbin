/**
 * Hash routes:
 *   #/                      home (compose)
 *   #/l/<payload>           self-contained link paste
 *   #/p/<payload>           self-contained link paste, password-protected
 *   #/n/<secret>            Nostr paste (32-byte secret, base64url → 43 chars)
 *   #/d/<nostrId‖ownerKey>  delete link (64 bytes base64url): does NOT carry the read secret
 * Any of the paste routes may end with `&L5` or `&L3-7` (highlighted line range).
 * Anything else → `{ kind: "not-found" }`.
 */
import { base64urlnopad } from "@scure/base";
import { toHex } from "./hex";

export interface LineRange {
  start: number;
  end: number;
}

export type Route =
  | { kind: "home" }
  | { kind: "not-found" }
  | { kind: "link"; payload: string; password: boolean; lines?: LineRange }
  | { kind: "nostr"; secret: Uint8Array; lines?: LineRange }
  | { kind: "delete"; nostrId: string; ownerKey: Uint8Array };

const B64URL = /^[A-Za-z0-9_-]+$/;
const NOT_FOUND: Route = { kind: "not-found" };

function decode(text: string, bytes: number): Uint8Array | null {
  if (!B64URL.test(text)) return null;
  try {
    const out = base64urlnopad.decode(text);
    return out.length === bytes ? new Uint8Array(out) : null;
  } catch {
    // malformed base64url is a not-found route, not an error
    return null;
  }
}

function parseLines(suffix: string): LineRange | null {
  const m = /^L([1-9]\d{0,6})(?:-([1-9]\d{0,6}))?$/.exec(suffix);
  if (!m?.[1]) return null;
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function parseRoute(hash: string): Route {
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  if (path === "" || path === "/") return { kind: "home" };
  const m = /^\/([lpnd])\/([^&/]+)(?:&(.*))?$/.exec(path);
  if (!m?.[1] || !m[2]) return NOT_FOUND;
  const [, tag, body, suffix] = m;
  let lines: LineRange | undefined;
  if (suffix !== undefined) {
    const parsed = tag === "d" ? null : parseLines(suffix);
    if (!parsed) return NOT_FOUND;
    lines = parsed;
  }
  const withLines = <T extends object>(r: T): T => (lines ? { ...r, lines } : r);
  switch (tag) {
    case "l":
    case "p":
      return B64URL.test(body)
        ? withLines({ kind: "link", payload: body, password: tag === "p" })
        : NOT_FOUND;
    case "n": {
      const secret = decode(body, 32);
      return secret ? withLines({ kind: "nostr", secret }) : NOT_FOUND;
    }
    case "d": {
      const raw = decode(body, 64);
      return raw
        ? { kind: "delete", nostrId: toHex(raw.slice(0, 32)), ownerKey: raw.slice(32) }
        : NOT_FOUND;
    }
    default:
      return NOT_FOUND;
  }
}

function linesSuffix(lines: LineRange | undefined): string {
  if (!lines) return "";
  return lines.start === lines.end ? `&L${lines.start}` : `&L${lines.start}-${lines.end}`;
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new TypeError("nostrId must be 64 lowercase hex chars");
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
}

export function serializeRoute(route: Route): string {
  switch (route.kind) {
    case "home":
      return "#/";
    case "not-found":
      return "#/404";
    case "link":
      return `#/${route.password ? "p" : "l"}/${route.payload}${linesSuffix(route.lines)}`;
    case "nostr":
      return `#/n/${base64urlnopad.encode(route.secret)}${linesSuffix(route.lines)}`;
    case "delete": {
      const raw = new Uint8Array(64);
      raw.set(hexToBytes(route.nostrId));
      raw.set(route.ownerKey, 32);
      return `#/d/${base64urlnopad.encode(raw)}`;
    }
  }
}
