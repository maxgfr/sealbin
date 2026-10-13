import { describe, expect, it } from "vitest";
import { DEFAULT_RELAYS, parseRelays } from "../src/core/relays";
import { buildCsp, securityMetas } from "./csp";

const directives = (csp: string) =>
  new Map(
    csp.split(";").map((d) => {
      const [name, ...values] = d.trim().split(/\s+/);
      return [name, values] as const;
    }),
  );

describe("buildCsp", () => {
  it("allows only self plus the default relays to connect", () => {
    const csp = directives(buildCsp(parseRelays(undefined)));
    expect(csp.get("connect-src")).toEqual(["'self'", ...DEFAULT_RELAYS]);
  });

  it("reflects a SEALBIN_RELAYS override", () => {
    const csp = directives(buildCsp(parseRelays(" ws://127.0.0.1:7777 , ")));
    expect(csp.get("connect-src")).toEqual(["'self'", "ws://127.0.0.1:7777"]);
    expect(buildCsp(parseRelays("ws://127.0.0.1:7777"))).not.toContain("relay.damus.io");
  });

  it("keeps the strict directives", () => {
    const raw = buildCsp(DEFAULT_RELAYS);
    const csp = directives(raw);
    expect(raw).not.toContain("'unsafe-eval'");
    expect(csp.get("default-src")).toEqual(["'self'"]);
    expect(csp.get("script-src")).toEqual(["'self'", "'wasm-unsafe-eval'"]);
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'none'"]);
    expect(csp.get("form-action")).toEqual(["'none'"]);
    expect(csp.get("font-src")).toEqual(["'self'"]);
    expect(csp.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(csp.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(csp.get("worker-src")).toEqual(["'self'"]);
    expect(csp.get("manifest-src")).toEqual(["'self'"]);
    expect(raw).not.toMatch(/\bhttps?:|\*/);
  });
});

describe("securityMetas", () => {
  it("emits the CSP and no-referrer metas", () => {
    const html = securityMetas(DEFAULT_RELAYS);
    expect(html).toContain('<meta http-equiv="Content-Security-Policy" content="default-src');
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
  });
});
