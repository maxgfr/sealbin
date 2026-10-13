import { describe, expect, it } from "vitest";
import { parseRoute, type Route } from "../core/link";
import { baseUrl, navigate, route, routeKey, routeUrl, startRouter } from "./routes";

const loc = { origin: "https://maxgfr.github.io", pathname: "/sealbin/" };

/** Minimal window stand-in: a hash, a history and hashchange listeners. */
function fakeWindow(hash = "") {
  const listeners = new Set<() => void>();
  const win = {
    location: {
      get hash() {
        return hash;
      },
      set hash(v: string) {
        hash = v;
        for (const l of listeners) l();
      },
    },
    history: {
      state: null,
      replaceState: (_s: unknown, _t: string, url: string) => {
        hash = url;
      },
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  return { win: win as unknown as Window, listeners, getHash: () => hash };
}

describe("URL helpers", () => {
  it("builds absolute URLs under the base path", () => {
    expect(baseUrl(loc)).toBe("https://maxgfr.github.io/sealbin/");
    expect(routeUrl({ kind: "link", payload: "abc", password: true }, loc)).toBe(
      "https://maxgfr.github.io/sealbin/#/p/abc",
    );
    const secret = new Uint8Array(32).fill(1);
    const url = routeUrl({ kind: "nostr", secret }, loc);
    expect(url.startsWith("https://maxgfr.github.io/sealbin/#/n/")).toBe(true);
    expect(parseRoute(new URL(url).hash)).toEqual({ kind: "nostr", secret });
  });

  it("builds delete URLs that round-trip", () => {
    const del: Route = {
      kind: "delete",
      nostrId: "ab".repeat(32),
      ownerKey: new Uint8Array(32).fill(7),
    };
    const url = routeUrl(del, loc);
    expect(parseRoute(new URL(url).hash)).toEqual(del);
  });

  it("gives distinct keys to distinct routes", () => {
    expect(routeKey({ kind: "home" })).toBe("#/");
    expect(routeKey({ kind: "link", payload: "a", password: false })).not.toBe(
      routeKey({ kind: "link", payload: "b", password: false }),
    );
  });

  it("keeps the same key when only the line range changes", () => {
    const base: Route = { kind: "link", payload: "a", password: false };
    expect(routeKey({ ...base, lines: { start: 3, end: 7 } })).toBe(routeKey(base));
  });
});

describe("router", () => {
  it("follows hashchange and stops when unsubscribed", () => {
    const { win, listeners } = fakeWindow("#/l/abc");
    const stop = startRouter(win);
    expect(route.value).toEqual({ kind: "link", payload: "abc", password: false });
    win.location.hash = "#/zzz";
    expect(route.value).toEqual({ kind: "not-found" });
    stop();
    expect(listeners.size).toBe(0);
  });

  it("navigates by hash, or replaces the entry without a hashchange", () => {
    const { win, getHash } = fakeWindow("#/l/abc");
    const stop = startRouter(win);
    navigate({ kind: "home" }, { win });
    expect(getHash()).toBe("#/");
    expect(route.value).toEqual({ kind: "home" });
    navigate({ kind: "link", payload: "xyz", password: false }, { win, replace: true });
    expect(getHash()).toBe("#/l/xyz");
    expect(route.value).toEqual({ kind: "link", payload: "xyz", password: false });
    stop();
  });
});
