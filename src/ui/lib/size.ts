/**
 * Size limits for sharing, and estimates of what a paste will weigh once sealed.
 * The sealed size is computed without encrypting: deflate-raw output + the fixed header, IV and
 * GCM tag (AES-GCM adds no padding), then base64url. It matches codec.ts's format v1.
 */

/** Many chat apps and browsers cut or refuse longer links. */
export const LINK_WARN_CHARS = 2_000;
/** Largest byte payload of a QR code (version 40, low error correction). */
export const QR_MAX_BYTES = 2_953;
/** Same as nostr.ts MAX_EVENT_CONTENT, kept here so the entry chunk does not import nostr. */
export const NOSTR_MAX_CHARS = 60_000;

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

export function linkState(length: number): MeterState {
  return length > LINK_WARN_CHARS ? "warning" : "ok";
}

export function nostrState(length: number): MeterState {
  if (length > NOSTR_MAX_CHARS) return "error";
  return length > NOSTR_MAX_CHARS * 0.9 ? "warning" : "ok";
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
