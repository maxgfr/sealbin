import { describe, expect, it } from "vitest";
import { parseThemePref } from "./theme";

describe("parseThemePref", () => {
  it("defaults when nothing is stored", () => {
    expect(parseThemePref(null)).toEqual({ scheme: "system", code: "auto" });
  });

  it("reads a stored choice", () => {
    expect(parseThemePref('{"scheme":"dark","code":"nord"}')).toEqual({
      scheme: "dark",
      code: "nord",
    });
  });

  it("ignores malformed or unknown values field by field", () => {
    expect(parseThemePref("{oops")).toEqual({ scheme: "system", code: "auto" });
    expect(parseThemePref('{"scheme":"neon","code":"nord"}')).toEqual({
      scheme: "system",
      code: "nord",
    });
    expect(parseThemePref('{"scheme":"light","code":"<x>"}')).toEqual({
      scheme: "light",
      code: "auto",
    });
  });
});
