import { describe, expect, it } from "vitest";
import { RELOADED_KEY, reloadedOnce, setReloaded } from "./reloadGuard";

function memory(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & {
  data: Map<string, string>;
} {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("reload guard", () => {
  it("sets the flag under sealbin's own key, and clears it", () => {
    const s = memory();
    expect(reloadedOnce(s)).toBe(false);
    expect(setReloaded(true, s)).toBe(true);
    expect([...s.data.keys()]).toEqual([RELOADED_KEY]);
    expect(reloadedOnce(s)).toBe(true);
    setReloaded(false, s);
    expect(reloadedOnce(s)).toBe(false);
  });

  it("honours, then removes, the flag set by an earlier version", () => {
    const s = memory();
    s.data.set("sb-reloaded-for-update", "1");
    expect(reloadedOnce(s)).toBe(true);
    setReloaded(false, s);
    expect(s.data.size).toBe(0);
  });

  it("reports a flag that could not be stored (sessionStorage full), so no reload loops", () => {
    const s = memory();
    s.setItem = () => {
      throw new DOMException("quota", "QuotaExceededError");
    };
    expect(setReloaded(true, s)).toBe(false);
    expect(reloadedOnce(s)).toBe(false);
  });

  it("treats a storage that refuses reads as already reloaded", () => {
    const s = memory();
    s.getItem = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    expect(reloadedOnce(s)).toBe(true);
  });
});
