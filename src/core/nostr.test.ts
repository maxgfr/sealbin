import type { Filter } from "nostr-tools/filter";
import { matchFilters } from "nostr-tools/filter";
import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import { type Event, finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type Paste, sealPaste, toBase64Url } from "./codec";
import {
  deriveBurnSigner,
  deriveNostrId,
  ExpiredError,
  PasswordRequiredError,
  TooLargeError,
  WrongPasswordError,
} from "./crypto";
import {
  burnPaste,
  deletePaste,
  fetchPaste,
  MAX_EVENT_CONTENT,
  NotFoundError,
  PASTE_KIND,
  type PoolLike,
  publishPaste,
  RelaysUnreachableError,
} from "./nostr";
import { startTestRelay, type TestRelay } from "./testing/relay";

// Real-socket tests run under Node: use `ws`, since undici's WebSocket re-fires
// "error" when nostr-tools closes a refused socket, recursing until stack overflow.
useWebSocketImplementation(WebSocket);

const FAST = { memoryKiB: 64, iterations: 1, parallelism: 1 };
const RELAYS = ["wss://a.example", "wss://b.example"];

function paste(overrides: Partial<Paste> = {}): Paste {
  return {
    v: 1,
    title: "t",
    lang: "plaintext",
    filename: "",
    expiresAt: null,
    burn: false,
    content: "hello nostr",
    ...overrides,
  };
}

/** In-memory pool: stores everything published, answers queries with matchFilters. */
class FakePool implements PoolLike {
  published: Event[] = [];
  extra: Event[] = [];
  constructor(
    private readonly reachable: Set<string> = new Set(RELAYS),
    private readonly accepting: Set<string> = reachable,
  ) {}
  publish(relays: string[], event: Event): Promise<string>[] {
    return relays.map((url) => {
      if (!this.accepting.has(url)) return Promise.reject(new Error(`${url}: connection failed`));
      this.published.push(event);
      return Promise.resolve("");
    });
  }
  async querySync(relays: string[], filter: Filter): Promise<Event[]> {
    if (!relays.some((r) => this.reachable.has(r))) return [];
    return [...this.published, ...this.extra].filter((e) => matchFilters([filter], e));
  }
  async ensureRelay(url: string): Promise<unknown> {
    if (!this.reachable.has(url)) throw new Error(`${url}: connection failed`);
    return {};
  }
}

const opts = (pool: PoolLike) => ({ pool, relays: RELAYS, timeoutMs: 500 });

describe("nostr store (mocked pool)", () => {
  it("publishes a kind-30078 event with d and expiration tags, signed by the owner key", async () => {
    const pool = new FakePool();
    const expiresAt = Date.now() + 3_600_000;
    const res = await publishPaste(paste({ expiresAt }), opts(pool));
    const event = pool.published[0];
    expect(event?.kind).toBe(PASTE_KIND);
    expect(event?.tags).toContainEqual(["d", await deriveNostrId(res.secret)]);
    expect(event?.tags).toContainEqual(["expiration", String(Math.ceil(expiresAt / 1000))]);
    expect(event?.pubkey).toBe(getPublicKey(res.ownerKey));
    expect(event?.pubkey).not.toBe(getPublicKey(await deriveBurnSigner(res.secret)));
    expect(res.nostrId).toBe(await deriveNostrId(res.secret));
    expect(res.acceptedBy).toEqual(RELAYS);
    expect(event?.tags.some((t) => t[0] === "expiration")).toBe(true);
  });

  it("omits the expiration tag for never-expiring pastes", async () => {
    const pool = new FakePool();
    await publishPaste(paste(), opts(pool));
    expect(pool.published[0]?.tags.some((t) => t[0] === "expiration")).toBe(false);
  });

  it("signs burn pastes with the key derived from the secret", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste({ burn: true }), opts(pool));
    const burnSigner = await deriveBurnSigner(res.secret);
    expect(pool.published[0]?.pubkey).toBe(getPublicKey(burnSigner));
    expect(res.ownerKey).toEqual(burnSigner);
  });

  it("round-trips through fetchPaste", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste(), opts(pool));
    const got = await fetchPaste(res.secret, opts(pool));
    expect(got.paste).toEqual(paste());
    expect(got.eventId).toBe(res.eventId);
  });

  it("handles passwords", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste(), { ...opts(pool), password: "pw", argon: FAST });
    await expect(fetchPaste(res.secret, opts(pool))).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(fetchPaste(res.secret, { ...opts(pool), password: "no" })).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    expect((await fetchPaste(res.secret, { ...opts(pool), password: "pw" })).paste).toEqual(
      paste(),
    );
  });

  it("ignores forged, re-signed and badly signed events with the same d tag", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste({ content: "genuine" }), opts(pool));
    const genuine = pool.published[0];
    if (!genuine) throw new Error("not published");
    const attacker = generateSecretKey();
    const later = genuine.created_at + 100;
    // 1. same ciphertext replayed under another author (would survive the owner's deletion)
    const replay = finalizeEvent(
      { kind: PASTE_KIND, tags: genuine.tags, content: genuine.content, created_at: later },
      attacker,
    );
    // 2. garbage content
    const garbage = finalizeEvent(
      { kind: PASTE_KIND, tags: genuine.tags, content: "AAAA", created_at: later },
      attacker,
    );
    // 3. valid ciphertext under the right key, but bound to another author
    const other = await sealPaste(paste({ content: "evil" }), res.secret);
    const unbound = finalizeEvent(
      { kind: PASTE_KIND, tags: genuine.tags, content: toBase64Url(other), created_at: later },
      attacker,
    );
    // 4. genuine event with a tampered signature
    const badSig: Event = JSON.parse(
      JSON.stringify({ ...genuine, content: `${genuine.content}A` }),
    );
    pool.extra.push(replay, garbage, unbound, badSig);
    pool.published = [];
    pool.extra.push(genuine);
    const got = await fetchPaste(res.secret, opts(pool));
    expect(got.paste.content).toBe("genuine");
  });

  it("returns NotFoundError when no relay has it", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste(), opts(pool));
    await expect(fetchPaste(res.secret, opts(new FakePool()))).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("returns RelaysUnreachableError when no relay can be reached", async () => {
    const res = await publishPaste(paste(), opts(new FakePool()));
    await expect(fetchPaste(res.secret, opts(new FakePool(new Set())))).rejects.toBeInstanceOf(
      RelaysUnreachableError,
    );
  });

  it("rejects expired pastes client-side", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste({ expiresAt: Date.now() + 1000 }), opts(pool));
    await expect(
      fetchPaste(res.secret, { ...opts(pool), now: Date.now() + 2000 }),
    ).rejects.toBeInstanceOf(ExpiredError);
  });

  it("succeeds with a quorum of one relay and fails when none accepts", async () => {
    const one = new FakePool(new Set(RELAYS), new Set([RELAYS[1] ?? ""]));
    expect((await publishPaste(paste(), opts(one))).acceptedBy).toEqual([RELAYS[1]]);
    await expect(publishPaste(paste(), opts(new FakePool(new Set())))).rejects.toBeInstanceOf(
      RelaysUnreachableError,
    );
  });

  it("throws TooLargeError before publishing", async () => {
    const pool = new FakePool();
    const noise = Array.from(crypto.getRandomValues(new Uint8Array(60_000)), (b) =>
      b.toString(36),
    ).join("");
    const err = await publishPaste(paste({ content: noise }), opts(pool)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TooLargeError);
    expect((err as TooLargeError).limit).toBe(MAX_EVENT_CONTENT);
    expect(pool.published).toHaveLength(0);
  });

  it("deletes with a NIP-09 kind-5 event signed by the owner key", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste(), opts(pool));
    await deletePaste(res.ownerKey, res.nostrId, { ...opts(pool), eventId: res.eventId });
    const del = pool.published.at(-1);
    expect(del?.kind).toBe(5);
    expect(del?.pubkey).toBe(getPublicKey(res.ownerKey));
    expect(del?.tags).toContainEqual(["a", `${PASTE_KIND}:${del?.pubkey}:${res.nostrId}`]);
    expect(del?.tags).toContainEqual(["e", res.eventId]);
    expect(del?.tags).toContainEqual(["k", String(PASTE_KIND)]);
  });

  it("lets the reader of a burn paste delete it with the derived key", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste({ burn: true }), opts(pool));
    const got = await fetchPaste(res.secret, opts(pool));
    await burnPaste(res.secret, got.eventId, opts(pool));
    const del = pool.published.at(-1);
    expect(del?.kind).toBe(5);
    expect(del?.pubkey).toBe(getPublicKey(await deriveBurnSigner(res.secret)));
  });
});

describe("nostr store tombstones (mocked pool)", () => {
  it("deletes with a newer empty kind-30078 tombstone and a kind-5 event, same key", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste(), opts(pool));
    const out = await deletePaste(res.ownerKey, res.nostrId, {
      ...opts(pool),
      eventId: res.eventId,
      createdAt: res.createdAt,
    });
    expect(out.acceptedBy).toEqual(RELAYS);
    const tomb = pool.published.find((e) => e.kind === PASTE_KIND && e.content === "");
    const del = pool.published.find((e) => e.kind === 5);
    expect(tomb?.kind).toBe(PASTE_KIND);
    expect(tomb?.content).toBe("");
    expect(tomb?.tags).toContainEqual(["d", res.nostrId]);
    expect(tomb?.pubkey).toBe(getPublicKey(res.ownerKey));
    expect(tomb?.created_at).toBeGreaterThan(res.createdAt);
    expect(del?.kind).toBe(5);
    expect(del?.pubkey).toBe(getPublicKey(res.ownerKey));
    await expect(fetchPaste(res.secret, opts(pool))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("makes the tombstone strictly newer than a paste dated in the future", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste(), opts(pool));
    const createdAt = res.createdAt + 50;
    await deletePaste(res.ownerKey, res.nostrId, { ...opts(pool), createdAt });
    const tomb = pool.published.find((e) => e.kind === PASTE_KIND && e.content === "");
    expect(tomb?.created_at).toBeGreaterThan(createdAt);
  });

  it("burns with a tombstone and a kind-5 event signed by the burn signer", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste({ burn: true }), opts(pool));
    const got = await fetchPaste(res.secret, opts(pool));
    await burnPaste(res.secret, got.eventId, { ...opts(pool), createdAt: got.createdAt });
    const burner = getPublicKey(await deriveBurnSigner(res.secret));
    const tomb = pool.published.find((e) => e.kind === PASTE_KIND && e.content === "");
    const del = pool.published.find((e) => e.kind === 5);
    expect(tomb?.kind).toBe(PASTE_KIND);
    expect(tomb?.content).toBe("");
    expect(tomb?.pubkey).toBe(burner);
    expect(del?.kind).toBe(5);
    expect(del?.pubkey).toBe(burner);
    await expect(fetchPaste(res.secret, opts(pool))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not fall back to an older event of the author once a tombstone exists", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste(), opts(pool));
    const genuine = pool.published[0];
    if (!genuine) throw new Error("not published");
    await deletePaste(res.ownerKey, res.nostrId, opts(pool));
    pool.extra.push(genuine);
    await expect(fetchPaste(res.secret, opts(pool))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("ignores a tombstone signed by another key", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste({ content: "genuine" }), opts(pool));
    const fake = finalizeEvent(
      { kind: PASTE_KIND, tags: [["d", res.nostrId]], content: "", created_at: res.createdAt + 10 },
      generateSecretKey(),
    );
    pool.extra.push(fake);
    expect((await fetchPaste(res.secret, opts(pool))).paste.content).toBe("genuine");
  });

  it("succeeds when only one of the two events is accepted, fails when none is", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste(), opts(pool));
    const flaky: PoolLike = {
      publish: (relays, event) =>
        relays.map(() =>
          event.kind === 5 ? Promise.reject(new Error("blocked")) : Promise.resolve(""),
        ),
      querySync: async () => [],
      ensureRelay: async () => ({}),
    };
    expect((await deletePaste(res.ownerKey, res.nostrId, opts(flaky))).acceptedBy).toEqual(RELAYS);
    await expect(
      deletePaste(res.ownerKey, res.nostrId, opts(new FakePool(new Set()))),
    ).rejects.toBeInstanceOf(RelaysUnreachableError);
  });
});

describe("nostr store (local relay)", () => {
  let relay: TestRelay;
  let pool: SimplePool;
  beforeAll(async () => {
    relay = await startTestRelay();
    pool = new SimplePool();
  });
  afterAll(async () => {
    pool.destroy();
    await relay.close();
  });

  it("publishes, fetches and deletes a paste", async () => {
    const o = { pool, relays: [relay.url], timeoutMs: 2000 };
    const res = await publishPaste(paste({ content: "over the wire" }), o);
    expect(res.acceptedBy).toEqual([relay.url]);
    expect((await fetchPaste(res.secret, o)).paste.content).toBe("over the wire");
    await deletePaste(res.ownerKey, res.nostrId, o);
    await expect(fetchPaste(res.secret, o)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("burns after reading", async () => {
    const o = { pool, relays: [relay.url], timeoutMs: 2000 };
    const res = await publishPaste(paste({ burn: true }), o);
    const got = await fetchPaste(res.secret, o);
    expect(got.paste.burn).toBe(true);
    await burnPaste(res.secret, got.eventId, o);
    await expect(fetchPaste(res.secret, o)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("burn leaves a tombstone that fetch ignores", async () => {
    const o = { pool, relays: [relay.url], timeoutMs: 2000 };
    const res = await publishPaste(paste({ burn: true, content: "once" }), o);
    const got = await fetchPaste(res.secret, o);
    expect(got.paste.content).toBe("once");
    await burnPaste(res.secret, got.eventId, { ...o, createdAt: got.createdAt });
    const left = relay
      .events()
      .filter((e) => e.tags.some((t) => t[0] === "d" && t[1] === res.nostrId));
    expect(left).toHaveLength(1);
    expect(left[0]?.content).toBe("");
    await expect(fetchPaste(res.secret, o)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("owner delete leaves a tombstone that fetch ignores", async () => {
    const o = { pool, relays: [relay.url], timeoutMs: 2000 };
    const res = await publishPaste(paste(), o);
    await deletePaste(res.ownerKey, res.nostrId, {
      ...o,
      eventId: res.eventId,
      createdAt: res.createdAt,
    });
    const left = relay
      .events()
      .filter((e) => e.tags.some((t) => t[0] === "d" && t[1] === res.nostrId));
    expect(left.map((e) => e.content)).toEqual([""]);
    await expect(fetchPaste(res.secret, o)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("keeps the newest addressable event", async () => {
    const o = { pool, relays: [relay.url], timeoutMs: 2000 };
    const res = await publishPaste(paste({ content: "newest" }), o);
    const genuine = relay.events().find((e) => e.id === res.eventId);
    if (!genuine) throw new Error("not stored");
    const older = finalizeEvent(
      { kind: PASTE_KIND, tags: genuine.tags, content: "", created_at: genuine.created_at - 10 },
      res.ownerKey,
    );
    await Promise.all(pool.publish([relay.url], older));
    expect((await fetchPaste(res.secret, o)).paste.content).toBe("newest");
  });

  it("does not honour a deletion signed by someone else", async () => {
    const o = { pool, relays: [relay.url], timeoutMs: 2000 };
    const res = await publishPaste(paste(), o);
    await deletePaste(generateSecretKey(), res.nostrId, o);
    expect((await fetchPaste(res.secret, o)).paste).toEqual(paste());
  });

  it("reports unreachable relays", async () => {
    const dead = await startTestRelay();
    const url = dead.url;
    await dead.close();
    const o = { pool: new SimplePool(), relays: [url], timeoutMs: 1000 };
    await expect(fetchPaste(new Uint8Array(32).fill(9), o)).rejects.toBeInstanceOf(
      RelaysUnreachableError,
    );
    await expect(publishPaste(paste(), o)).rejects.toBeInstanceOf(RelaysUnreachableError);
    o.pool.destroy();
  });
});
