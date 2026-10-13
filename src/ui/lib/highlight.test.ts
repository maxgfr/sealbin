import { describe, expect, it } from "vitest";
import { HIGHLIGHT_MAX_BYTES, HIGHLIGHT_MAX_LINES, highlightLimit, splitLines } from "./highlight";

describe("highlight limits", () => {
  it("are 500 KB and 20,000 lines", () => {
    expect(HIGHLIGHT_MAX_BYTES).toBe(512_000);
    expect(HIGHLIGHT_MAX_LINES).toBe(20_000);
  });

  it("allows content at the limits", () => {
    expect(highlightLimit("a".repeat(HIGHLIGHT_MAX_BYTES))).toBeNull();
    expect(highlightLimit("x\n".repeat(HIGHLIGHT_MAX_LINES))).toBeNull();
  });

  it("stops one byte over the byte limit, counting UTF-8 bytes", () => {
    expect(highlightLimit("a".repeat(HIGHLIGHT_MAX_BYTES + 1))).toBe("bytes");
    // 2 bytes per "é": half the characters already reach the limit
    expect(highlightLimit("é".repeat(HIGHLIGHT_MAX_BYTES / 2 + 1))).toBe("bytes");
    expect(highlightLimit("é".repeat(HIGHLIGHT_MAX_BYTES / 2))).toBeNull();
  });

  it("stops one line over the line limit", () => {
    expect(highlightLimit("x\n".repeat(HIGHLIGHT_MAX_LINES + 1))).toBe("lines");
  });
});

describe("splitLines", () => {
  it("splits on every newline style and ignores one trailing newline", () => {
    expect(splitLines("a\nb\r\nc\rd\n")).toEqual(["a", "b", "c", "d"]);
    expect(splitLines("")).toEqual([""]);
    expect(splitLines("\n")).toEqual([""]);
    expect(splitLines("a\n\n")).toEqual(["a", ""]);
  });
});
