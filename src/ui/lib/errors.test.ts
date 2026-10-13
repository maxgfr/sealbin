import { describe, expect, it } from "vitest";
import * as crypto from "../../core/crypto";
import * as coreErrors from "../../core/errors";
import * as nostr from "../../core/nostr";
import { describeError, FALLBACK_TITLE } from "./errors";

/** Every exported class that is SealbinError or extends it, from the modules that throw them. */
function errorClasses(): [string, new (...args: never[]) => Error][] {
  const found = new Map<string, new (...args: never[]) => Error>();
  for (const mod of [coreErrors, crypto, nostr]) {
    for (const [name, value] of Object.entries(mod)) {
      if (
        typeof value === "function" &&
        (value === crypto.SealbinError || value.prototype instanceof crypto.SealbinError)
      ) {
        found.set(name, value as new (...args: never[]) => Error);
      }
    }
  }
  return [...found];
}

describe("describeError", () => {
  const classes = errorClasses();

  it("finds the known error classes", () => {
    expect(classes.map(([name]) => name).sort()).toEqual(
      [
        "CorruptPayloadError",
        "ExpiredError",
        "NotFoundError",
        "PasswordRequiredError",
        "RelaysUnreachableError",
        "SealbinError",
        "TooLargeError",
        "UnsupportedVersionError",
        "WrongKeyError",
        "WrongPasswordError",
      ].sort(),
    );
  });

  it.each(classes)("maps %s to its own copy", (_name, Kind) => {
    // Numeric arguments satisfy every constructor (message, expiresAt, version, size/limit).
    const err: unknown = Reflect.construct(Kind, [1_700_000_000_000, 2]);
    const copy = describeError(err);
    expect(copy.title).not.toBe(FALLBACK_TITLE);
    expect(copy.body).not.toBe("");
    expect(copy.action.label).not.toBe("");
  });

  it("gives distinct titles to distinct subclasses", () => {
    const titles = classes
      .filter(([name]) => name !== "SealbinError")
      .map(([, Kind]) => describeError(Reflect.construct(Kind, [1, 2])).title);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("names the recovery for the common cases", () => {
    expect(describeError(new crypto.WrongPasswordError("x")).body).toBe(
      "Wrong password. Try again or ask the sender for it.",
    );
    expect(describeError(new nostr.RelaysUnreachableError("x")).action.kind).toBe("retry");
    expect(describeError(new nostr.NotFoundError("x")).action.kind).toBe("home");
  });

  it("falls back for unknown errors", () => {
    expect(describeError(new Error("boom")).title).toBe(FALLBACK_TITLE);
    expect(describeError("weird").title).toBe(FALLBACK_TITLE);
  });
});
