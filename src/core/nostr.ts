/**
 * Short-link storage on Nostr relays.
 *
 * Event: kind 30078 (NIP-78 app data, addressable), tags `d` = nostrId (HKDF of the secret)
 * and NIP-40 `expiration` when the paste expires; content = base64url(sealed paste).
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
/** Max base64url content per event (no chunking); most public relays cap events at 64–128 KB. */
export const MAX_EVENT_CONTENT = 60_000;
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
  eventId: string;
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

const authorBinding = (pubkey: string) =>
  new TextEncoder().encode(`sealbin/nostr-author:${pubkey}`);

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
  if (content.length > MAX_EVENT_CONTENT)
    throw new TooLargeError(content.length, MAX_EVENT_CONTENT);

  const tags = [["d", nostrId]];
  if (paste.expiresAt !== null)
    tags.push(["expiration", String(Math.ceil(paste.expiresAt / 1000))]);
  const event = finalizeEvent(
    { kind: PASTE_KIND, tags, content, created_at: Math.floor(Date.now() / 1000) },
    ownerKey,
  );
  const acceptedBy = await publishEvent(event, opts);
  return { secret, nostrId, ownerKey, eventId: event.id, createdAt: event.created_at, acceptedBy };
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
      const open: { aad: Uint8Array; password?: string; now?: number } = {
        aad: authorBinding(event.pubkey),
      };
      if (opts.password !== undefined) open.password = opts.password;
      if (opts.now !== undefined) open.now = opts.now;
      const paste = await openPaste(fromBase64Url(event.content), secret, open);
      return {
        paste,
        nostrId,
        eventId: event.id,
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
  for (const Kind of [ExpiredError, PasswordRequiredError, WrongPasswordError]) {
    const hit = failures.find((f) => f instanceof Kind);
    if (hit) throw hit;
  }
  throw new NotFoundError("No valid paste event found", { cause: failures });
}

export interface DeleteOptions extends NostrOptions {
  /** Id of the paste event, added as an `e` tag to the kind-5 deletion. */
  eventId?: string;
  /** created_at of the paste event; defaults to now. The tombstone is always strictly newer. */
  createdAt?: number;
}

/**
 * Destroys the paste addressed by (kind, owner pubkey, nostrId): publishes a tombstone and a
 * NIP-09 deletion. Best effort: succeeds if any relay accepted either event.
 */
export async function deletePaste(
  ownerKey: Uint8Array,
  nostrId: string,
  opts: DeleteOptions = {},
): Promise<{ acceptedBy: string[] }> {
  const pubkey = getPublicKey(ownerKey);
  const now = Math.floor(Date.now() / 1000);
  const tombstone = finalizeEvent(
    {
      kind: PASTE_KIND,
      tags: [["d", nostrId]],
      content: "",
      created_at: Math.max(now, opts.createdAt ?? now) + 1,
    },
    ownerKey,
  );
  const tags = [
    ["a", `${PASTE_KIND}:${pubkey}:${nostrId}`],
    ["k", String(PASTE_KIND)],
  ];
  if (opts.eventId) tags.push(["e", opts.eventId]);
  const deletion = finalizeEvent(
    { kind: DELETION_KIND, tags, content: "", created_at: now },
    ownerKey,
  );
  const results = await Promise.allSettled([
    publishEvent(tombstone, opts),
    publishEvent(deletion, opts),
  ]);
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
  opts: NostrOptions & { createdAt?: number } = {},
): Promise<{ acceptedBy: string[] }> {
  return deletePaste(await deriveBurnSigner(secret), await deriveNostrId(secret), {
    ...opts,
    eventId,
  });
}
