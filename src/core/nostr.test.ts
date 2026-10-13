import type { Filter } from "nostr-tools/filter";
import { matchFilters } from "nostr-tools/filter";
import { SimplePool, useWebSocketImplementation } from "nostr-tools/pool";
import { type Event, finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { MAX_PLAINTEXT_BYTES, type Paste, sealPaste, toBase64Url } from "./codec";
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
  CHUNK_CHARS,
  chunkId,
  deletePaste,
  fetchPaste,
  MAX_CHUNKS,
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

/** `chars` characters of incompressible text (random base64). */
function noise(chars: number): string {
  let out = "";
  while (out.length < chars) {
    const bytes = crypto.getRandomValues(new Uint8Array(49_152));
    let bin = "";
    for (let k = 0; k < bytes.length; k += 8_192)
      bin += String.fromCharCode(...bytes.subarray(k, k + 8_192));
    out += btoa(bin);
  }
  return out.slice(0, chars);
}

/** Distinct events (FakePool records one copy per relay). */
const unique = (events: Event[]) => [...new Map(events.map((e) => [e.id, e])).values()];

const dTag = (e: Event) => e.tags.find((t) => t[0] === "d")?.[1];

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
    const big = noise(MAX_PLAINTEXT_BYTES + 1);
    const err = await publishPaste(paste({ content: big }), opts(pool)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TooLargeError);
    expect((err as TooLargeError).limit).toBe(MAX_PLAINTEXT_BYTES);
    expect(pool.published).toHaveLength(0);
  });

  it("fits the largest incompressible paste in MAX_CHUNKS chunks", async () => {
    const pool = new FakePool();
    // the JSON adds the other fields and the quotes around the content
    const room = MAX_PLAINTEXT_BYTES - JSON.stringify(paste({ content: "" })).length;
    const res = await publishPaste(paste({ content: noise(room) }), opts(pool));
    const head = pool.published.find((e) => e.id === res.eventId);
    const count = Number(head?.tags.find((t) => t[0] === "chunks")?.[1]);
    expect(count).toBeGreaterThan(1);
    expect(count).toBeLessThanOrEqual(MAX_CHUNKS);
    expect(unique(pool.published)).toHaveLength(count);
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

describe("chunked pastes (mocked pool)", () => {
  it("splits a long paste into chunks of the same author and reads it back", async () => {
    const pool = new FakePool();
    const content = noise(500_000);
    const expiresAt = Date.now() + 3_600_000;
    const res = await publishPaste(paste({ content, expiresAt }), opts(pool));
    const count = unique(pool.published).length;
    expect(count).toBeGreaterThan(1);
    const head = pool.published.find((e) => e.id === res.eventId);
    expect(head?.tags).toContainEqual(["d", res.nostrId]);
    expect(head?.tags).toContainEqual(["chunks", String(count)]);
    for (const e of unique(pool.published)) {
      expect(e.kind).toBe(PASTE_KIND);
      expect(e.pubkey).toBe(getPublicKey(res.ownerKey));
      expect(e.content.length).toBeLessThanOrEqual(CHUNK_CHARS);
      expect(e.tags).toContainEqual(["expiration", String(Math.ceil(expiresAt / 1000))]);
    }
    expect(unique(pool.published).map(dTag).sort()).toEqual(
      Array.from({ length: count }, (_, i) => chunkId(res.nostrId, i)).sort(),
    );
    const got = await fetchPaste(res.secret, opts(pool));
    expect(got.paste.content).toBe(content);
    expect(got.chunks).toBe(count);
    expect(got.eventId).toBe(res.eventId);
  });

  it("keeps a short paste in one event without a chunks tag", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste(), opts(pool));
    expect(unique(pool.published)).toHaveLength(1);
    expect(pool.published[0]?.tags.some((t) => t[0] === "chunks")).toBe(false);
    expect((await fetchPaste(res.secret, opts(pool))).chunks).toBe(1);
  });

  it("still opens a single-event paste published before chunking", async () => {
    const pool = new FakePool();
    const secret = new Uint8Array(32).fill(7);
    const owner = generateSecretKey();
    const aad = new TextEncoder().encode(`sealbin/nostr-author:${getPublicKey(owner)}`);
    const sealed = toBase64Url(await sealPaste(paste({ content: "legacy" }), secret, { aad }));
    pool.extra.push(
      finalizeEvent(
        {
          kind: PASTE_KIND,
          tags: [["d", await deriveNostrId(secret)]],
          content: sealed,
          created_at: Math.floor(Date.now() / 1000),
        },
        owner,
      ),
    );
    const got = await fetchPaste(secret, opts(pool));
    expect(got.paste.content).toBe("legacy");
    expect(got.chunks).toBe(1);
  });

  it("reports a missing chunk as NotFoundError", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste({ content: noise(300_000) }), opts(pool));
    pool.published = pool.published.filter((e) => dTag(e) !== chunkId(res.nostrId, 1));
    const err = await fetchPaste(res.secret, opts(pool)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as Error).message).toMatch(/missing/);
  });

  it("ignores chunks forged by another pubkey", async () => {
    const pool = new FakePool();
    const content = noise(300_000);
    const res = await publishPaste(paste({ content }), opts(pool));
    const attacker = generateSecretKey();
    const d1 = chunkId(res.nostrId, 1);
    const genuine = pool.published.find((e) => dTag(e) === d1);
    if (!genuine) throw new Error("not published");
    const forged = finalizeEvent(
      {
        kind: PASTE_KIND,
        tags: [["d", d1]],
        content: "A".repeat(10),
        created_at: genuine.created_at + 100,
      },
      attacker,
    );
    const forgedTomb = finalizeEvent(
      { kind: PASTE_KIND, tags: [["d", d1]], content: "", created_at: genuine.created_at + 200 },
      attacker,
    );
    pool.extra.push(forged, forgedTomb);
    expect((await fetchPaste(res.secret, opts(pool))).paste.content).toBe(content);
    // without the genuine chunk, the forged one is not used
    pool.published = pool.published.filter((e) => e.id !== genuine.id);
    await expect(fetchPaste(res.secret, opts(pool))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("fails to publish when any chunk is refused by every relay", async () => {
    const pool = new FakePool();
    let n = 0;
    const picky: PoolLike = {
      publish: (relays, event) => {
        n++;
        return n === 2
          ? relays.map(() => Promise.reject(new Error("rate-limited")))
          : pool.publish(relays, event);
      },
      querySync: (relays, filter) => pool.querySync(relays, filter),
      ensureRelay: (url) => pool.ensureRelay(url),
    };
    await expect(
      publishPaste(paste({ content: noise(300_000) }), opts(picky)),
    ).rejects.toBeInstanceOf(RelaysUnreachableError);
    expect(
      pool.published.some((e) => !e.tags.some((t) => t[0] === "d" && t[1]?.includes(":"))),
    ).toBe(false);
  });

  it("deletes every chunk, discovering the count from the relays", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste({ content: noise(300_000) }), opts(pool));
    const count = unique(pool.published).length;
    await deletePaste(res.ownerKey, res.nostrId, opts(pool));
    const tombs = unique(pool.published).filter((e) => e.kind === PASTE_KIND && e.content === "");
    expect(tombs.map(dTag).sort()).toEqual(
      Array.from({ length: count }, (_, i) => chunkId(res.nostrId, i)).sort(),
    );
    const del = pool.published.at(-1);
    expect(del?.kind).toBe(5);
    for (let i = 0; i < count; i++)
      expect(del?.tags).toContainEqual([
        "a",
        `${PASTE_KIND}:${del?.pubkey}:${chunkId(res.nostrId, i)}`,
      ]);
    expect(del?.tags).toContainEqual(["e", res.eventId]);
    await expect(fetchPaste(res.secret, opts(pool))).rejects.toBeInstanceOf(NotFoundError);
  });

  it("burns every chunk of a chunked burn paste", async () => {
    const pool = new FakePool();
    const res = await publishPaste(paste({ burn: true, content: noise(300_000) }), opts(pool));
    const got = await fetchPaste(res.secret, opts(pool));
    await burnPaste(res.secret, got.eventId, {
      ...opts(pool),
      createdAt: got.createdAt,
      chunks: got.chunks,
    });
    const tombs = unique(pool.published).filter((e) => e.kind === PASTE_KIND && e.content === "");
    expect(tombs).toHaveLength(got.chunks);
    await expect(fetchPaste(res.secret, opts(pool))).rejects.toBeInstanceOf(NotFoundError);
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

  it("round-trips and deletes a 500 KB paste through a relay capped at 131,072 bytes", async () => {
    const strict = await startTestRelay(0, { maxMessageLength: 131_072 });
    const o = { pool, relays: [strict.url], timeoutMs: 2000 };
    const content = noise(500_000);
    const res = await publishPaste(paste({ content }), o);
    expect(strict.events().length).toBeGreaterThan(1);
    const got = await fetchPaste(res.secret, o);
    expect(got.paste.content).toBe(content);
    await deletePaste(res.ownerKey, res.nostrId, o);
    expect(strict.events().every((e) => e.kind === 5 || e.content === "")).toBe(true);
    await expect(fetchPaste(res.secret, o)).rejects.toBeInstanceOf(NotFoundError);
    await strict.close();
  });

  it("refuses events over the relay's max message length", async () => {
    const strict = await startTestRelay(0, { maxMessageLength: 131_072 });
    const owner = generateSecretKey();
    const big = finalizeEvent(
      {
        kind: PASTE_KIND,
        tags: [["d", "x"]],
        content: "A".repeat(140_000),
        created_at: Math.floor(Date.now() / 1000),
      },
      owner,
    );
    const [result] = await Promise.allSettled(pool.publish([strict.url], big));
    expect(result?.status).toBe("rejected");
    expect(strict.events()).toHaveLength(0);
    await strict.close();
  });

  it("burns a chunked paste after reading", async () => {
    const o = { pool, relays: [relay.url], timeoutMs: 2000 };
    const res = await publishPaste(paste({ burn: true, content: noise(250_000) }), o);
    const got = await fetchPaste(res.secret, o);
    expect(got.chunks).toBeGreaterThan(1);
    await burnPaste(res.secret, got.eventId, {
      ...o,
      createdAt: got.createdAt,
      chunks: got.chunks,
    });
    await expect(fetchPaste(res.secret, o)).rejects.toBeInstanceOf(NotFoundError);
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
