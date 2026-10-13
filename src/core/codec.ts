/**
 * Paste ⇄ sealed bytes.
 *
 * Sealed format v1 (all integers big-endian):
 *   [0]      version (= 1)
 *   [1]      flags: bit0 = password-protected; other bits must be 0
 *   if password:
 *     [2..18)  argon2id salt (16 bytes)
 *     u32      memory (KiB)
 *     u8       iterations
 *     u8       parallelism
 *   12 bytes   AES-GCM IV (random)
 *   rest       AES-256-GCM(deflate-raw(JSON(paste)))
 * The GCM additional data is the header bytes ‖ an optional caller-supplied binding
 * (nostr.ts binds the event author's pubkey), so the header cannot be altered either.
 *
 * Link payload = base64url(secret(32) ‖ sealed).
 */
import { base64urlnopad } from "@scure/base";
import {
  type ArgonParams,
  CorruptPayloadError,
  concat,
  DEFAULT_ARGON,
  deriveEncKey,
  ExpiredError,
  generateSecret,
  hashPassword,
  MAX_ARGON,
  PasswordRequiredError,
  randomBytes,
  SALT_BYTES,
  SECRET_BYTES,
  TooLargeError,
  UnsupportedVersionError,
  WrongKeyError,
  WrongPasswordError,
} from "./crypto";

export const FORMAT_VERSION = 1;
export const PASTE_VERSION = 1;
const FLAG_PASSWORD = 0b1;
const IV_BYTES = 12;
const ARGON_HEADER_BYTES = SALT_BYTES + 4 + 1 + 1;
/** Max size of the JSON before compression, and of what decompression may produce. */
export const MAX_PLAINTEXT_BYTES = 2 * 1024 * 1024;

export interface Paste {
  v: number;
  title: string;
  lang: string;
  filename: string;
  /** ms since epoch, or null for never. */
  expiresAt: number | null;
  burn: boolean;
  content: string;
}

export interface SealOptions {
  password?: string;
  /** Defaults to DEFAULT_ARGON; tests pass a cheap setting. */
  argon?: ArgonParams;
  /** Extra authenticated data the opener must present identically. */
  aad?: Uint8Array;
}

export interface OpenOptions {
  password?: string;
  aad?: Uint8Array;
  /** Clock for the expiry check (ms epoch). */
  now?: number;
}

async function pipe(
  data: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
  limit: number,
) {
  const reader = new Blob([data]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new TooLargeError(size, limit);
    }
    chunks.push(value);
  }
  return concat(...chunks);
}

function isPaste(x: unknown): x is Paste {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Record<string, unknown>;
  return (
    typeof p.v === "number" &&
    typeof p.title === "string" &&
    typeof p.lang === "string" &&
    typeof p.filename === "string" &&
    (p.expiresAt === null || typeof p.expiresAt === "number") &&
    typeof p.burn === "boolean" &&
    typeof p.content === "string"
  );
}

export async function sealPaste(
  paste: Paste,
  secret: Uint8Array,
  opts: SealOptions = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const json = new TextEncoder().encode(JSON.stringify(paste));
  if (json.length > MAX_PLAINTEXT_BYTES) throw new TooLargeError(json.length, MAX_PLAINTEXT_BYTES);
  const compressed = await pipe(
    json,
    new CompressionStream("deflate-raw"),
    Number.POSITIVE_INFINITY,
  );

  let header: Uint8Array<ArrayBuffer>;
  let passwordHash: Uint8Array | undefined;
  if (opts.password !== undefined) {
    const argon = opts.argon ?? DEFAULT_ARGON;
    const salt = randomBytes(SALT_BYTES);
    header = new Uint8Array(2 + ARGON_HEADER_BYTES);
    header[0] = FORMAT_VERSION;
    header[1] = FLAG_PASSWORD;
    header.set(salt, 2);
    const view = new DataView(header.buffer);
    view.setUint32(2 + SALT_BYTES, argon.memoryKiB);
    view.setUint8(2 + SALT_BYTES + 4, argon.iterations);
    view.setUint8(2 + SALT_BYTES + 5, argon.parallelism);
    passwordHash = await hashPassword(opts.password, salt, argon);
  } else {
    header = new Uint8Array([FORMAT_VERSION, 0]);
  }
  const key = await deriveEncKey(secret, passwordHash);
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: concat(header, opts.aad ?? new Uint8Array()) },
    key,
    compressed,
  );
  return concat(header, iv, new Uint8Array(ct));
}

export async function openPaste(
  sealed: Uint8Array,
  secret: Uint8Array,
  opts: OpenOptions = {},
): Promise<Paste> {
  if (sealed.length < 2) throw new CorruptPayloadError("Payload too short");
  const version = sealed[0] ?? 0;
  if (version !== FORMAT_VERSION) throw new UnsupportedVersionError(version);
  const flags = sealed[1] ?? 0;
  if ((flags & ~FLAG_PASSWORD) !== 0) throw new CorruptPayloadError("Unknown header flags");
  const hasPassword = (flags & FLAG_PASSWORD) !== 0;
  const headerLen = 2 + (hasPassword ? ARGON_HEADER_BYTES : 0);
  // 16 = GCM tag
  if (sealed.length < headerLen + IV_BYTES + 16) throw new CorruptPayloadError("Payload truncated");
  const header = sealed.slice(0, headerLen);

  let passwordHash: Uint8Array | undefined;
  if (hasPassword) {
    const view = new DataView(header.buffer);
    const argon: ArgonParams = {
      memoryKiB: view.getUint32(2 + SALT_BYTES),
      iterations: view.getUint8(2 + SALT_BYTES + 4),
      parallelism: view.getUint8(2 + SALT_BYTES + 5),
    };
    if (
      argon.memoryKiB < 8 * argon.parallelism ||
      argon.memoryKiB > MAX_ARGON.memoryKiB ||
      argon.iterations < 1 ||
      argon.iterations > MAX_ARGON.iterations ||
      argon.parallelism < 1 ||
      argon.parallelism > MAX_ARGON.parallelism
    ) {
      throw new CorruptPayloadError("Argon2 parameters out of bounds");
    }
    if (opts.password === undefined) throw new PasswordRequiredError("This paste needs a password");
    passwordHash = await hashPassword(opts.password, header.slice(2, 2 + SALT_BYTES), argon);
  }
  const key = await deriveEncKey(secret, passwordHash);
  const iv = sealed.slice(headerLen, headerLen + IV_BYTES);
  let compressed: ArrayBuffer;
  try {
    compressed = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: concat(header, opts.aad ?? new Uint8Array()) },
      key,
      sealed.slice(headerLen + IV_BYTES),
    );
  } catch (err) {
    if (hasPassword) throw new WrongPasswordError("Wrong password", { cause: err });
    throw new WrongKeyError("This key cannot decrypt the paste", { cause: err });
  }

  let paste: unknown;
  try {
    const json = await pipe(
      new Uint8Array(compressed),
      new DecompressionStream("deflate-raw"),
      MAX_PLAINTEXT_BYTES,
    );
    paste = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch (err) {
    if (err instanceof TooLargeError) throw err;
    throw new CorruptPayloadError("Decrypted payload is not a valid paste", { cause: err });
  }
  if (!isPaste(paste)) throw new CorruptPayloadError("Decrypted payload is not a valid paste");
  if (paste.v !== PASTE_VERSION) throw new UnsupportedVersionError(paste.v);
  if (paste.expiresAt !== null && (opts.now ?? Date.now()) >= paste.expiresAt) {
    throw new ExpiredError(paste.expiresAt);
  }
  return paste;
}

export function toBase64Url(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  try {
    return new Uint8Array(base64urlnopad.decode(text));
  } catch (err) {
    throw new CorruptPayloadError("Invalid base64url", { cause: err });
  }
}

/** Self-contained link payload: the secret travels with the ciphertext in the URL fragment. */
export async function encodeLinkPayload(
  paste: Paste,
  opts: Omit<SealOptions, "aad"> = {},
): Promise<string> {
  const secret = generateSecret();
  return toBase64Url(concat(secret, await sealPaste(paste, secret, opts)));
}

export async function decodeLinkPayload(
  payload: string,
  opts: Omit<OpenOptions, "aad"> = {},
): Promise<Paste> {
  const bytes = fromBase64Url(payload);
  if (bytes.length <= SECRET_BYTES) throw new CorruptPayloadError("Payload too short");
  return openPaste(bytes.slice(SECRET_BYTES), bytes.slice(0, SECRET_BYTES), opts);
}
