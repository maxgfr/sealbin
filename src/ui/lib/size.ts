/**
 * Size limits for sharing, and estimates of what a paste will weigh once sealed.
 * The sealed size is computed without encrypting: deflate-raw output + the fixed header, IV and
 * GCM tag (AES-GCM adds no padding), then base64url. It matches codec.ts's format v1.
 */

/** Not a limit: above this, some chat apps and browsers cut links, so a hint suggests a short link. */
export const LINK_WARN_CHARS = 2_000;
/** Largest byte payload of a QR code (version 40, low error correction). */
export const QR_MAX_BYTES = 2_953;
/** Same as codec.ts MAX_PLAINTEXT_BYTES: the real limit of a paste, in both modes. */
export const MAX_PASTE_BYTES = 2 * 1024 * 1024;
/** Same as nostr.ts CHUNK_CHARS and MAX_CHUNKS, kept here so the entry chunk does not import nostr. */
export const NOSTR_CHUNK_CHARS = 100_000;
export const NOSTR_MAX_CHUNKS = 28;
export const NOSTR_MAX_CHARS = NOSTR_CHUNK_CHARS * NOSTR_MAX_CHUNKS;

const SECRET_BYTES = 32;
/** version + flags */
const HEADER_BYTES = 2;
/** salt(16) + memory(4) + iterations(1) + parallelism(1) */
const PASSWORD_HEADER_BYTES = 22;
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type MeterState = "ok" | "warning" | "error";

/** Characters of unpadded base64url for `bytes` bytes. */
export function base64UrlLength(bytes: number): number {
  return Math.ceil((bytes * 4) / 3);
}

/** Bytes of the sealed paste for a compressed body of `compressed` bytes. */
export function sealedBytes(compressed: number, password: boolean): number {
  return HEADER_BYTES + (password ? PASSWORD_HEADER_BYTES : 0) + IV_BYTES + compressed + TAG_BYTES;
}

/** Length of a link-mode URL: base URL + `#/l/` + base64url(secret ‖ sealed). */
export function linkLength(baseUrlLength: number, sealed: number): number {
  return baseUrlLength + "#/l/".length + base64UrlLength(SECRET_BYTES + sealed);
}

/** Length of the Nostr event content: base64url(sealed). */
export function nostrContentLength(sealed: number): number {
  return base64UrlLength(sealed);
}

/** UTF-8 bytes of the paste JSON, the size codec.ts checks against MAX_PASTE_BYTES. */
export function pasteBytes(json: string): number {
  return new TextEncoder().encode(json).length;
}

/** "warning" only means "long link, suggest a short one"; links have no hard length limit. */
export function linkState(length: number, bytes: number): MeterState {
  if (bytes > MAX_PASTE_BYTES) return "error";
  return length > LINK_WARN_CHARS ? "warning" : "ok";
}

export function nostrState(length: number, bytes: number): MeterState {
  if (bytes > MAX_PASTE_BYTES || length > NOSTR_MAX_CHARS) return "error";
  return bytes > MAX_PASTE_BYTES * 0.9 ? "warning" : "ok";
}

/** Relay events a short link of `length` content characters is split into. */
export function nostrChunks(length: number): number {
  return Math.max(1, Math.ceil(length / NOSTR_CHUNK_CHARS));
}

/** "1.2 MB", "340 KB", "900 bytes" (decimal units, as people read them). */
export function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} bytes`;
}

/** Why a paste of `bytes` (JSON) bytes cannot be shared, or null when it fits the limit. */
export function tooLargeText(bytes: number): string | null {
  if (bytes <= MAX_PASTE_BYTES) return null;
  return `Too large to share: ${formatSize(bytes)}, the limit is ${formatSize(MAX_PASTE_BYTES)}. Shorten it.`;
}

/** A QR code is offered only when the URL fits in one. */
export function fitsQr(url: string): boolean {
  return new TextEncoder().encode(url).length <= QR_MAX_BYTES;
}

/** deflate-raw size of `text`, the same compression codec.ts applies before sealing. */
export async function deflatedSize(text: string): Promise<number> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  let size = 0;
  for await (const chunk of stream) size += chunk.length;
  return size;
}
