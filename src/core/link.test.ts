import { describe, expect, it } from "vitest";
import { parseRoute, type Route, serializeRoute } from "./link";

const secret = new Uint8Array(32).fill(0xab);
const ownerKey = new Uint8Array(32).fill(0x11);
const nostrId = "cd".repeat(32);

describe("parseRoute / serializeRoute", () => {
  const cases: Route[] = [
    { kind: "home" },
    { kind: "link", payload: "AbC-_x", password: false },
    { kind: "link", payload: "AbC-_x", password: true },
    { kind: "link", payload: "AbC", password: false, lines: { start: 3, end: 7 } },
    { kind: "link", payload: "AbC", password: false, lines: { start: 5, end: 5 } },
    { kind: "nostr", secret },
    { kind: "nostr", secret, lines: { start: 1, end: 2 } },
    { kind: "delete", nostrId, ownerKey },
  ];
  for (const route of cases) {
    it(`round-trips ${JSON.stringify(route)}`, () => {
      expect(parseRoute(serializeRoute(route))).toEqual(route);
    });
  }

  it("uses the documented shapes", () => {
    expect(serializeRoute({ kind: "link", payload: "P", password: false })).toBe("#/l/P");
    expect(serializeRoute({ kind: "link", payload: "P", password: true })).toBe("#/p/P");
    expect(
      serializeRoute({ kind: "link", payload: "P", password: false, lines: { start: 3, end: 7 } }),
    ).toBe("#/l/P&L3-7");
    expect(
      serializeRoute({ kind: "link", payload: "P", password: false, lines: { start: 5, end: 5 } }),
    ).toBe("#/l/P&L5");
    const n = serializeRoute({ kind: "nostr", secret });
    expect(n).toMatch(/^#\/n\/[A-Za-z0-9_-]{43}$/);
    expect(serializeRoute({ kind: "delete", nostrId, ownerKey })).toMatch(/^#\/d\/[A-Za-z0-9_-]+$/);
  });

  it("parses with or without the leading #", () => {
    expect(parseRoute("/l/P&L5")).toEqual({
      kind: "link",
      payload: "P",
      password: false,
      lines: { start: 5, end: 5 },
    });
    expect(parseRoute("")).toEqual({ kind: "home" });
    expect(parseRoute("#/")).toEqual({ kind: "home" });
    expect(parseRoute("#")).toEqual({ kind: "home" });
  });

  it("normalises reversed line ranges", () => {
    expect(parseRoute("#/l/P&L7-3")).toMatchObject({ lines: { start: 3, end: 7 } });
  });

  it("maps anything unknown or malformed to not-found", () => {
    for (const hash of [
      "#/x/abc",
      "#/l/",
      "#/l/a b",
      "#/n/short",
      `#/n/${"A".repeat(44)}`,
      "#/d/abc",
      "#/l/P&L0",
      "#/l/P&Lx",
      "#/l/P&foo",
      "#/l/P/extra",
      "#nonsense",
    ]) {
      expect(parseRoute(hash), hash).toEqual({ kind: "not-found" });
    }
  });
});
