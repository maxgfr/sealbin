import { describe, expect, it } from "vitest";
import { resolveScope, type ScopeRule } from "./editorTheme";

const RULES: ScopeRule[] = [
  { settings: { foreground: "#000000" } },
  { scope: "keyword", settings: { foreground: "#ff0000" } },
  { scope: ["string", "constant.numeric"], settings: { foreground: "#00ff00" } },
  { scope: "keyword.control, storage", settings: { foreground: "#0000ff" } },
  { scope: "comment", settings: { foreground: "#888888", fontStyle: "italic" } },
  { scope: "meta.tag string", settings: { foreground: "#123456" } },
  { scope: "string", settings: { foreground: "#00aa00" } },
];

describe("resolveScope", () => {
  it("matches a selector against the scope and its children", () => {
    expect(resolveScope(RULES, "keyword")).toEqual({ color: "#ff0000" });
    expect(resolveScope(RULES, "keyword.operator")).toEqual({ color: "#ff0000" });
    expect(resolveScope(RULES, "keywords")).toBeNull();
  });

  it("prefers the most specific selector, from comma lists and arrays alike", () => {
    expect(resolveScope(RULES, "keyword.control.flow")).toEqual({ color: "#0000ff" });
    expect(resolveScope(RULES, "storage.type")).toEqual({ color: "#0000ff" });
    expect(resolveScope(RULES, "constant.numeric.integer")).toEqual({ color: "#00ff00" });
  });

  it("lets a later rule win a tie and ignores parent-scope selectors", () => {
    expect(resolveScope(RULES, "string.quoted")).toEqual({ color: "#00aa00" });
  });

  it("keeps the font style and ignores rules without a scope", () => {
    expect(resolveScope(RULES, "comment.line")).toEqual({ color: "#888888", fontStyle: "italic" });
    expect(resolveScope(RULES, "variable")).toBeNull();
  });
});
