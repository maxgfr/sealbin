import { describe, expect, it } from "vitest";
import { DEFAULT_EXPIRY, EXPIRY_OPTIONS, expiresAt, formatTimeLeft, isExpiryId } from "./expiry";

const NOW = 1_700_000_000_000;

describe("expiresAt", () => {
  it("adds the option's duration to now", () => {
    expect(expiresAt("10m", NOW)).toBe(NOW + 600_000);
    expect(expiresAt("1h", NOW)).toBe(NOW + 3_600_000);
    expect(expiresAt("1d", NOW)).toBe(NOW + 86_400_000);
    expect(expiresAt("1w", NOW)).toBe(NOW + 7 * 86_400_000);
    expect(expiresAt("1mo", NOW)).toBe(NOW + 30 * 86_400_000);
  });

  it("returns null for never", () => {
    expect(expiresAt("never", NOW)).toBeNull();
  });

  it("offers the six options in order, with a valid default", () => {
    expect(EXPIRY_OPTIONS.map((o) => o.id)).toEqual(["10m", "1h", "1d", "1w", "1mo", "never"]);
    expect(isExpiryId(DEFAULT_EXPIRY)).toBe(true);
    expect(isExpiryId("2y")).toBe(false);
  });
});

describe("formatTimeLeft", () => {
  it("names the largest whole unit left", () => {
    expect(formatTimeLeft(NOW + 3 * 86_400_000 + 5_000, NOW)).toBe("3 days");
    expect(formatTimeLeft(NOW + 86_400_000, NOW)).toBe("1 day");
    expect(formatTimeLeft(NOW + 2 * 3_600_000 + 59_000, NOW)).toBe("2 hours");
    expect(formatTimeLeft(NOW + 60_000, NOW)).toBe("1 minute");
  });

  it("says less than a minute at the end", () => {
    expect(formatTimeLeft(NOW + 59_999, NOW)).toBe("less than a minute");
    expect(formatTimeLeft(NOW - 1, NOW)).toBe("less than a minute");
  });
});
