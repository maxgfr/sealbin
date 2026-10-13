/**
 * Key material for sealbin.
 *
 * Every paste has one random 32-byte `secret`. Everything else is derived from it with
 * HKDF-SHA-256 (empty salt) and a distinct `info` label, so knowing one derived value never
 * reveals another:
 *   - `sealbin/v1/enc`         → AES-256-GCM key (IKM = secret, or secret ‖ argon2id(pwd) with a password)
 *   - `sealbin/v1/nostr-id`    → 32 bytes, hex: the `d` tag of the Nostr event
 *   - `sealbin/v1/burn-signer` → secp256k1 secret key that signs (and later deletes) burn pastes
 *
 * Non-burn Nostr pastes are signed by a random `owner key` (see nostr.ts), shown once in the
 * delete link. Passwords go through argon2id (hash-wasm, imported on demand); the parameters travel in the payload
 * header so they can be raised later without breaking old links.
 */
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { SealbinError } from "./errors";
import { toHex } from "./hex";

export { toHex };

export const SECRET_BYTES = 32;
export const SALT_BYTES = 16;

export interface ArgonParams {
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/** OWASP 2023 argon2id baseline (19 MiB, t=2, p=1): ~0.3–1 s in a browser via Wasm. */
export const DEFAULT_ARGON: ArgonParams = { memoryKiB: 19_456, iterations: 2, parallelism: 1 };
/** Upper bounds accepted from an (untrusted) payload header, to avoid hostile CPU/RAM burns. */
export const MAX_ARGON: ArgonParams = { memoryKiB: 262_144, iterations: 10, parallelism: 4 };

export {
  CorruptPayloadError,
  ExpiredError,
  PasswordRequiredError,
  SealbinError,
  TooLargeError,
  UnsupportedVersionError,
  WrongKeyError,
  WrongPasswordError,
} from "./errors";

const enc = new TextEncoder();

export function generateSecret(): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Random secp256k1 secret key that owns (signs and can delete) a non-burn Nostr paste. */
export function generateOwnerKey(): Uint8Array {
  return generateSecretKey();
}

async function hkdf(
  ikm: Uint8Array<ArrayBuffer>,
  info: string,
  bytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: enc.encode(info) },
    base,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export async function deriveNostrId(secret: Uint8Array): Promise<string> {
  return toHex(await hkdf(concat(secret), "sealbin/v1/nostr-id", 32));
}

/** Deterministic, valid secp256k1 key; retries with a counter in the (astronomically rare) invalid case. */
export async function deriveBurnSigner(secret: Uint8Array): Promise<Uint8Array> {
  for (let i = 0; ; i++) {
    const sk = await hkdf(concat(secret), `sealbin/v1/burn-signer${i === 0 ? "" : `/${i}`}`, 32);
    try {
      getPublicKey(sk);
      return sk;
    } catch (err) {
      if (i >= 8) throw new SealbinError("Could not derive a burn signer", { cause: err });
    }
  }
}

export async function hashPassword(
  password: string,
  salt: Uint8Array,
  params: ArgonParams = DEFAULT_ARGON,
): Promise<Uint8Array> {
  // hash-wasm (argon2 Wasm) is only loaded when a password is actually used.
  const { argon2id } = await import("hash-wasm");
  return argon2id({
    password,
    salt,
    iterations: params.iterations,
    parallelism: params.parallelism,
    memorySize: params.memoryKiB,
    hashLength: 32,
    outputType: "binary",
  });
}

/** AES-256-GCM key; with a password, IKM = secret ‖ argon2id(password, salt). */
export async function deriveEncKey(
  secret: Uint8Array,
  passwordHash?: Uint8Array,
): Promise<CryptoKey> {
  const ikm = passwordHash ? concat(secret, passwordHash) : concat(secret);
  const raw = await hkdf(ikm, "sealbin/v1/enc", 32);
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export { concat };
