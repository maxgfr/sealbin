import { describe, expect, it } from "vitest";
import { encodeLinkPayload, PASTE_VERSION, type Paste } from "../../core/codec";
import {
  base64UrlLength,
  deflatedSize,
  fitsQr,
  LINK_WARN_CHARS,
  linkLength,
  linkState,
  NOSTR_MAX_CHARS,
  nostrState,
  QR_MAX_BYTES,
  sealedBytes,
} from "./size";

describe("thresholds", () => {
  it("match the documented limits", () => {
    expect(LINK_WARN_CHARS).toBe(2_000);
    expect(QR_MAX_BYTES).toBe(2_953);
    expect(NOSTR_MAX_CHARS).toBe(60_000);
  });

  it("warns on links over 2,000 characters", () => {
    expect(linkState(2_000)).toBe("ok");
    expect(linkState(2_001)).toBe("warning");
  });

  it("warns near and refuses over the Nostr cap", () => {
    expect(nostrState(53_999)).toBe("ok");
    expect(nostrState(54_001)).toBe("warning");
    expect(nostrState(60_000)).toBe("warning");
    expect(nostrState(60_001)).toBe("error");
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
