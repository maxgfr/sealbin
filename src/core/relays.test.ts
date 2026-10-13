import { describe, expect, it } from "vitest";
import { DEFAULT_RELAYS, parseRelays, RELAYS } from "./relays";

describe("relays", () => {
  it("falls back to the defaults when the override is missing or blank", () => {
    expect(parseRelays(undefined)).toEqual(DEFAULT_RELAYS);
    expect(parseRelays("")).toEqual(DEFAULT_RELAYS);
    expect(parseRelays(" , ,")).toEqual(DEFAULT_RELAYS);
  });

  it("splits and trims a comma-separated override", () => {
    expect(parseRelays(" wss://a.example ,wss://b.example,, ")).toEqual([
      "wss://a.example",
      "wss://b.example",
    ]);
  });

  it("uses the defaults under vitest (no define)", () => {
    expect(RELAYS).toEqual(DEFAULT_RELAYS);
  });
});
