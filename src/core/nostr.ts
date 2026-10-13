/**
 * Short-link storage on Nostr relays.
 *
 * Event: kind 30078 (NIP-78 app data, addressable), tags `d` = nostrId (HKDF of the secret)
 * and NIP-40 `expiration` when the paste expires; content = base64url(sealed paste).
 *
 * Long pastes are split into chunks of at most CHUNK_CHARS characters, one event each, so every
 * event stays under the strictest public relay limit (131,072 bytes per message). Chunk 0 keeps
 * `d` = nostrId and carries a `chunks` tag with the count (absent = 1, the format of pastes
 * published before chunking); chunk i > 0 uses `d` = `<nostrId>:<i>`. All chunks are signed by
 * the same key. Readers fetch the other chunks by `d` + that author only, then open the joined
 * blob: the AES-GCM tag covers the whole blob, so a missing, reordered or forged chunk fails.
 * Deletion tombstones every chunk; the delete link only holds (nostrId, owner key), so
 * `deletePaste` reads the count from the author's chunk 0 when the caller does not know it.
 *
 * Who signs (and therefore who can delete, since NIP-09 only honours deletions by the author):
 *   - burn paste   → `burnSigner`, derived from the secret: any reader can burn it after reading.
 *   - normal paste → a random owner key, returned once by `publishPaste` (the delete link).
 *     Readers only hold the secret, so they cannot delete it.
 *
 * Deleting publishes both a NIP-09 kind-5 deletion and a tombstone: a newer kind-30078 event with
 * the same `d` tag and empty content, which replaces the paste on relays that ignore kind 5.
 * `fetchPaste` treats a tombstone as "destroyed" for every paste event by the same author.
 *
 * Readers do not know the owner's pubkey, so `fetchPaste` filters by kind + `#d` only (the burn
 * pubkey is not enough to cover normal pastes). Authenticity instead comes from the ciphertext:
 * it is AES-GCM-bound (additional data) to the author's pubkey, so only someone holding the secret
 * can produce an event that opens, and a copy of the ciphertext re-signed by another key (which
 * would survive the owner's deletion) fails to open and is ignored.
 */
import type { Filter } from "nostr-tools/filter";
import { type Event, finalizeEvent, getPublicKey, verifyEvent } from "nostr-tools/pure";
import {
  fromBase64Url,
  MAX_PLAINTEXT_BYTES,
  openPaste,
  type Paste,
  type SealOptions,
  sealPaste,
  toBase64Url,
} from "./codec";
import {
  type ArgonParams,
  deriveBurnSigner,
  deriveNostrId,
  ExpiredError,
  generateOwnerKey,
  generateSecret,
  PasswordRequiredError,
  SealbinError,
  TooLargeError,
  WrongPasswordError,
} from "./crypto";
import { NotFoundError, RelaysUnreachableError } from "./errors";
import { RELAYS } from "./relays";

export const PASTE_KIND = 30078;
export const DELETION_KIND = 5;
/** Max base64url characters per event: leaves room for the event JSON under 131,072 bytes. */
export const CHUNK_CHARS = 100_000;
/**
 * Enough chunks for the largest sealed paste: deflate of MAX_PLAINTEXT_BYTES (zlib's worst-case
 * bound for incompressible input) plus the header, Argon2 parameters, IV and GCM tag.
 */
const MAX_SEALED_BYTES =
  MAX_PLAINTEXT_BYTES +
  (MAX_PLAINTEXT_BYTES >> 12) +
  (MAX_PLAINTEXT_BYTES >> 14) +
  (MAX_PLAINTEXT_BYTES >> 25) +
  13 +
  2 +
  22 +
  12 +
  16;
export const MAX_CHUNKS = Math.ceil(Math.ceil((MAX_SEALED_BYTES * 4) / 3) / CHUNK_CHARS);
/** Max base64url content of a paste, all chunks together. */
export const MAX_CONTENT_CHARS = MAX_CHUNKS * CHUNK_CHARS;
/** Chunks published at once, to stay under relay rate limits. */
const PUBLISH_CONCURRENCY = 3;
export const DEFAULT_TIMEOUT_MS = 6_000;

export { NotFoundError, RelaysUnreachableError };

/** The subset of nostr-tools' SimplePool used here (injectable for tests). */
export interface PoolLike {
  publish(relays: string[], event: Event): Promise<string>[];
  querySync(relays: string[], filter: Filter, params?: { maxWait?: number }): Promise<Event[]>;
  ensureRelay(url: string, params?: { connectionTimeout?: number }): Promise<unknown>;
}

export interface NostrOptions {
  /** Defaults to a lazily created shared SimplePool. */
  pool?: PoolLike;
  relays?: readonly string[];
  timeoutMs?: number;
}

export interface PublishResult {
  secret: Uint8Array;
  nostrId: string;
  /** Signs deletions: the random owner key, or the burn signer for burn pastes. */
  ownerKey: Uint8Array;
  eventId: string;
  /** created_at of the paste event (seconds); a tombstone must be strictly newer. */
  createdAt: number;
  acceptedBy: string[];
}

export interface FetchResult {
  paste: Paste;
  nostrId: string;
  /** Id of chunk 0. */
  eventId: string;
  /** Number of chunks the paste is stored in. */
  chunks: number;
  createdAt: number;
  pubkey: string;
}

let shared: PoolLike | undefined;
async function resolvePool(opts: NostrOptions): Promise<PoolLike> {
  if (opts.pool) return opts.pool;
  if (!shared) {
    const { SimplePool } = await import("nostr-tools/pool");
    shared = new SimplePool();
  }
  return shared;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function publishEvent(event: Event, opts: NostrOptions): Promise<string[]> {
  const pool = await resolvePool(opts);
  const relays = [...(opts.relays ?? RELAYS)];
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results = await Promise.allSettled(
    pool.publish(relays, event).map((p, i) => withTimeout(p, ms, relays[i] ?? "relay")),
  );
  const accepted = relays.filter((_, i) => results[i]?.status === "fulfilled");
  if (accepted.length === 0) {
    const reasons = results.map((r) => (r.status === "rejected" ? r.reason : null));
    throw new RelaysUnreachableError("No relay accepted the event", { cause: reasons });
  }
  return accepted;
}

/** Runs `fn` over `items`, at most `limit` at a time; rejects with the first failure. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const authorBinding = (pubkey: string) =>
  new TextEncoder().encode(`sealbin/nostr-author:${pubkey}`);

/** `d` tag of chunk `index`: chunk 0 is the nostrId itself (pastes from before chunking). */
export const chunkId = (nostrId: string, index: number) =>
  index === 0 ? nostrId : `${nostrId}:${index}`;

const tagValue = (event: Event, name: string) => event.tags.find((t) => t[0] === name)?.[1];

/** Chunk count announced by chunk 0, or null when the tag is malformed or out of range. */
function chunkCount(event: Event): number | null {
  const raw = tagValue(event, "chunks");
  if (raw === undefined) return 1;
  const n = Number(raw);
  return /^[1-9][0-9]*$/.test(raw) && n <= MAX_CHUNKS ? n : null;
}

export async function publishPaste(
  paste: Paste,
  opts: NostrOptions & { password?: string; argon?: ArgonParams; secret?: Uint8Array } = {},
): Promise<PublishResult> {
  const secret = opts.secret ?? generateSecret();
  const nostrId = await deriveNostrId(secret);
  const ownerKey = paste.burn ? await deriveBurnSigner(secret) : generateOwnerKey();
  const pubkey = getPublicKey(ownerKey);
  const seal: SealOptions = { aad: authorBinding(pubkey) };
  if (opts.password !== undefined) seal.password = opts.password;
  if (opts.argon) seal.argon = opts.argon;
  const content = toBase64Url(await sealPaste(paste, secret, seal));
  if (content.length > MAX_CONTENT_CHARS)
    throw new TooLargeError(content.length, MAX_CONTENT_CHARS);

  const count = Math.max(1, Math.ceil(content.length / CHUNK_CHARS));
  const createdAt = Math.floor(Date.now() / 1000);
  const events = Array.from({ length: count }, (_, i) => {
    const tags = [["d", chunkId(nostrId, i)]];
    if (i === 0 && count > 1) tags.push(["chunks", String(count)]);
    if (paste.expiresAt !== null)
      tags.push(["expiration", String(Math.ceil(paste.expiresAt / 1000))]);
    const part = content.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
    return finalizeEvent(
      { kind: PASTE_KIND, tags, content: part, created_at: createdAt },
      ownerKey,
    );
  });
  const [head, ...rest] = events as [Event, ...Event[]];
  // Every chunk must reach at least one relay. Chunk 0 goes last: until it is out, the paste
  // does not exist for readers, so a failed publish never leaves a half-readable paste.
  await mapLimit(rest, PUBLISH_CONCURRENCY, (event) => publishEvent(event, opts));
  const acceptedBy = await publishEvent(head, opts);
  return { secret, nostrId, ownerKey, eventId: head.id, createdAt, acceptedBy };
}

/**
 * Joins the content of chunks 1..count-1 of `pubkey`'s paste after `head`. Events by other
 * authors are ignored; a missing or tombstoned chunk means the paste cannot be read.
 */
async function joinChunks(
  pool: PoolLike,
  relays: string[],
  ms: number,
  nostrId: string,
  head: Event,
  count: number,
): Promise<string> {
  if (count === 1) return head.content;
  const ids = Array.from({ length: count - 1 }, (_, i) => chunkId(nostrId, i + 1));
  const events = await pool.querySync(
    relays,
    { kinds: [PASTE_KIND], authors: [head.pubkey], "#d": ids },
    { maxWait: ms },
  );
  const newest = new Map<string, Event>();
  for (const event of events) {
    const d = tagValue(event, "d");
    if (d === undefined || !ids.includes(d)) continue;
    if (event.kind !== PASTE_KIND || event.pubkey !== head.pubkey || !verifyEvent(event)) continue;
    const seen = newest.get(d);
    if (!seen || event.created_at > seen.created_at) newest.set(d, event);
  }
  const parts = [head.content];
  for (const d of ids) {
    const event = newest.get(d);
    if (!event || event.content === "")
      throw new NotFoundError(`Part ${parts.length + 1} of ${count} of this paste is missing`);
    parts.push(event.content);
  }
  return parts.join("");
}

export async function fetchPaste(
  secret: Uint8Array,
  opts: NostrOptions & { password?: string; now?: number } = {},
): Promise<FetchResult> {
  const pool = await resolvePool(opts);
  const relays = [...(opts.relays ?? RELAYS)];
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const nostrId = await deriveNostrId(secret);
  const events = await pool.querySync(
    relays,
    { kinds: [PASTE_KIND], "#d": [nostrId] },
    { maxWait: ms },
  );

  if (events.length === 0) {
    const reach = await Promise.allSettled(
      relays.map((url) => withTimeout(pool.ensureRelay(url, { connectionTimeout: ms }), ms, url)),
    );
    if (reach.every((r) => r.status === "rejected")) {
      throw new RelaysUnreachableError("No relay could be reached", {
        cause: reach.map((r) => (r.status === "rejected" ? r.reason : null)),
      });
    }
    throw new NotFoundError("Paste not found (deleted, expired or never published)");
  }

  // Newest first; the first event that verifies and opens wins. An author's tombstone (verified,
  // empty content) destroys all of that author's events; other authors cannot sign one for them.
  const candidates = [...events].sort((a, b) => b.created_at - a.created_at);
  const failures: unknown[] = [];
  const valid = candidates.filter((event) => {
    const ok = event.kind === PASTE_KIND && verifyEvent(event);
    if (!ok) failures.push(new SealbinError(`Invalid event ${event.id}`));
    return ok;
  });
  const tombstoned = new Set(valid.filter((e) => e.content === "").map((e) => e.pubkey));
  for (const event of valid) {
    if (tombstoned.has(event.pubkey)) continue;
    try {
      const count = chunkCount(event);
      if (count === null) throw new SealbinError(`Invalid chunk count in event ${event.id}`);
      const content = await joinChunks(pool, relays, ms, nostrId, event, count);
      const open: { aad: Uint8Array; password?: string; now?: number } = {
        aad: authorBinding(event.pubkey),
      };
      if (opts.password !== undefined) open.password = opts.password;
      if (opts.now !== undefined) open.now = opts.now;
      const paste = await openPaste(fromBase64Url(content), secret, open);
      return {
        paste,
        nostrId,
        eventId: event.id,
        chunks: count,
        createdAt: event.created_at,
        pubkey: event.pubkey,
      };
    } catch (err) {
      failures.push(err);
    }
  }
  // Nothing opened: surface the most meaningful failure. ExpiredError is only raised after a
  // successful decryption, so it is authentic; password errors may come from forged headers,
  // but are harmless (a correct password then opens the genuine event).
  // A missing chunk of an otherwise genuine paste is reported as such (still a NotFoundError).
  for (const Kind of [ExpiredError, PasswordRequiredError, WrongPasswordError, NotFoundError]) {
    const hit = failures.find((f) => f instanceof Kind);
    if (hit) throw hit;
  }
  throw new NotFoundError("No valid paste event found", { cause: failures });
}

export interface DeleteOptions extends NostrOptions {
  /** Id of the paste event, added as an `e` tag to the kind-5 deletion. */
  eventId?: string;
  /**
   * Number of chunks to destroy. When unknown (the delete link does not carry it), it is read
   * from the `chunks` tag of the author's chunk 0 on the relays.
   */
  chunks?: number;
  /** created_at of the paste event; defaults to now. The tombstone is always strictly newer. */
  createdAt?: number;
}

/** Chunk count and event ids of the author's live chunk 0, read from the relays. */
async function discoverChunks(
  pubkey: string,
  nostrId: string,
  opts: NostrOptions,
): Promise<{ count: number; eventIds: string[] }> {
  const pool = await resolvePool(opts);
  const events = await pool.querySync(
    [...(opts.relays ?? RELAYS)],
    { kinds: [PASTE_KIND], authors: [pubkey], "#d": [nostrId] },
    { maxWait: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS },
  );
  let count = 1;
  const eventIds: string[] = [];
  for (const event of events) {
    if (event.pubkey !== pubkey || tagValue(event, "d") !== nostrId) continue;
    if (event.content === "" || !verifyEvent(event)) continue;
    eventIds.push(event.id);
    count = Math.max(count, chunkCount(event) ?? 1);
  }
  return { count, eventIds };
}

/**
 * Destroys the paste addressed by (kind, owner pubkey, nostrId): publishes a tombstone per chunk
 * and one NIP-09 deletion naming every chunk. Best effort: succeeds if any relay accepted any of
 * these events (the chunk 0 tombstone alone already makes the paste unreadable).
 */
export async function deletePaste(
  ownerKey: Uint8Array,
  nostrId: string,
  opts: DeleteOptions = {},
): Promise<{ acceptedBy: string[] }> {
  const pubkey = getPublicKey(ownerKey);
  const now = Math.floor(Date.now() / 1000);
  const eventIds = opts.eventId ? [opts.eventId] : [];
  let count = opts.chunks;
  if (count === undefined) {
    const found = await discoverChunks(pubkey, nostrId, opts);
    count = found.count;
    for (const id of found.eventIds) if (!eventIds.includes(id)) eventIds.push(id);
  }
  count = Math.min(Math.max(1, count), MAX_CHUNKS);
  const ids = Array.from({ length: count }, (_, i) => chunkId(nostrId, i));
  const tombstones = ids.map((d) =>
    finalizeEvent(
      {
        kind: PASTE_KIND,
        tags: [["d", d]],
        content: "",
        created_at: Math.max(now, opts.createdAt ?? now) + 1,
      },
      ownerKey,
    ),
  );
  const tags = [
    ...ids.map((d) => ["a", `${PASTE_KIND}:${pubkey}:${d}`]),
    ["k", String(PASTE_KIND)],
  ];
  for (const id of eventIds) tags.push(["e", id]);
  const deletion = finalizeEvent(
    { kind: DELETION_KIND, tags, content: "", created_at: now },
    ownerKey,
  );
  const settle = (event: Event) =>
    publishEvent(event, opts).then(
      (value) => ({ status: "fulfilled" as const, value }),
      (reason: unknown) => ({ status: "rejected" as const, reason }),
    );
  // Chunk 0 first, so the paste is unreadable as early as possible; the kind-5 event last.
  const results = await mapLimit(tombstones, PUBLISH_CONCURRENCY, settle);
  results.push(await settle(deletion));
  const accepted = new Set<string>();
  for (const r of results)
    if (r.status === "fulfilled") for (const url of r.value) accepted.add(url);
  if (accepted.size === 0) {
    throw new RelaysUnreachableError("No relay accepted the deletion", {
      cause: results.map((r) => (r.status === "rejected" ? r.reason : null)),
    });
  }
  return { acceptedBy: [...accepted] };
}

/** Burn after reading: the reader deletes the paste with the key derived from the secret. */
export async function burnPaste(
  secret: Uint8Array,
  eventId: string,
  opts: NostrOptions & { createdAt?: number; chunks?: number } = {},
): Promise<{ acceptedBy: string[] }> {
  return deletePaste(await deriveBurnSigner(secret), await deriveNostrId(secret), {
    ...opts,
    eventId,
  });
}
