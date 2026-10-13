import { describe, expect, it } from "vitest";
import {
  encodeLinkPayload,
  MAX_PLAINTEXT_BYTES,
  PASTE_VERSION,
  type Paste,
} from "../../core/codec";
import { CHUNK_CHARS, MAX_CHUNKS, MAX_CONTENT_CHARS } from "../../core/nostr";
import {
  base64UrlLength,
  deflatedSize,
  fitsQr,
  formatSize,
  LINK_WARN_CHARS,
  linkLength,
  linkState,
  MAX_PASTE_BYTES,
  NOSTR_CHUNK_CHARS,
  NOSTR_MAX_CHARS,
  NOSTR_MAX_CHUNKS,
  nostrChunks,
  nostrState,
  pasteBytes,
  QR_MAX_BYTES,
  sealedBytes,
  tooLargeText,
} from "./size";

describe("thresholds", () => {
  it("match the documented limits", () => {
    expect(LINK_WARN_CHARS).toBe(2_000);
    expect(QR_MAX_BYTES).toBe(2_953);
    expect(MAX_PASTE_BYTES).toBe(2 * 1024 * 1024);
    expect(NOSTR_CHUNK_CHARS).toBe(100_000);
    expect(NOSTR_MAX_CHUNKS).toBe(28);
    expect(NOSTR_MAX_CHARS).toBe(2_800_000);
  });

  it("mirror the core limits without importing them", () => {
    expect(MAX_PASTE_BYTES).toBe(MAX_PLAINTEXT_BYTES);
    expect(NOSTR_CHUNK_CHARS).toBe(CHUNK_CHARS);
    expect(NOSTR_MAX_CHUNKS).toBe(MAX_CHUNKS);
    expect(NOSTR_MAX_CHARS).toBe(MAX_CONTENT_CHARS);
  });

  it("only hints on long links, and refuses only over the paste limit", () => {
    expect(linkState(2_000, 1_000)).toBe("ok");
    expect(linkState(2_001, 1_000)).toBe("warning");
    expect(linkState(2_500_000, MAX_PASTE_BYTES)).toBe("warning");
    expect(linkState(2_500_000, MAX_PASTE_BYTES + 1)).toBe("error");
  });

  it("warns near and refuses over the short-link limit", () => {
    const near = Math.floor(MAX_PASTE_BYTES * 0.9);
    expect(nostrState(60_001, 100_000)).toBe("ok");
    expect(nostrState(500_000, near)).toBe("ok");
    expect(nostrState(500_000, near + 1)).toBe("warning");
    expect(nostrState(2_800_000, MAX_PASTE_BYTES)).toBe("warning");
    expect(nostrState(2_800_000, MAX_PASTE_BYTES + 1)).toBe("error");
    expect(nostrState(2_800_001, 1_000)).toBe("error");
  });

  it("counts relay events and formats sizes", () => {
    expect(nostrChunks(0)).toBe(1);
    expect(nostrChunks(100_000)).toBe(1);
    expect(nostrChunks(100_001)).toBe(2);
    expect(nostrChunks(2_800_000)).toBe(28);
    expect(pasteBytes("é")).toBe(2);
    expect(formatSize(900)).toBe("900 bytes");
    expect(formatSize(340_000)).toBe("340 KB");
    expect(formatSize(MAX_PASTE_BYTES)).toBe("2.1 MB");
  });

  it("offers a QR code up to 2,953 bytes", () => {
    expect(fitsQr("a".repeat(2_953))).toBe(true);
    expect(fitsQr("a".repeat(2_954))).toBe(false);
    expect(fitsQr("é".repeat(1_477))).toBe(false);
  });
});

describe("estimates", () => {
  it("compute unpadded base64url lengths", () => {
    expect(base64UrlLength(0)).toBe(0);
    expect(base64UrlLength(1)).toBe(2);
    expect(base64UrlLength(32)).toBe(43);
    expect(base64UrlLength(33)).toBe(44);
  });

  it("predict the real link length exactly", async () => {
    const paste: Paste = {
      v: PASTE_VERSION,
      title: "t",
      lang: "rust",
      filename: "main.rs",
      expiresAt: null,
      burn: false,
      content: 'fn main() { println!("hello"); }\n'.repeat(20),
    };
    const payload = await encodeLinkPayload(paste);
    const compressed = await deflatedSize(JSON.stringify(paste));
    const base = "https://maxgfr.github.io/sealbin/";
    expect(linkLength(base.length, sealedBytes(compressed, false))).toBe(
      `${base}#/l/${payload}`.length,
    );
  });
});

describe("tooLargeText", () => {
  it("is null up to the limit and explains past it", () => {
    expect(tooLargeText(MAX_PASTE_BYTES)).toBeNull();
    expect(tooLargeText(MAX_PASTE_BYTES + 1)).toBe(
      "Too large to share: 2.1 MB, the limit is 2.1 MB. Shorten it.",
    );
  });
});
