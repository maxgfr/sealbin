import { describe, expect, it } from "vitest";
import {
  decodeLinkPayload,
  encodeLinkPayload,
  FORMAT_VERSION,
  openPaste,
  type Paste,
  sealPaste,
} from "./codec";
import {
  CorruptPayloadError,
  ExpiredError,
  generateSecret,
  PasswordRequiredError,
  TooLargeError,
  UnsupportedVersionError,
  WrongKeyError,
  WrongPasswordError,
} from "./crypto";

const FAST = { memoryKiB: 64, iterations: 1, parallelism: 1 };

function paste(overrides: Partial<Paste> = {}): Paste {
  return {
    v: 1,
    title: "hello",
    lang: "typescript",
    filename: "hello.ts",
    expiresAt: null,
    burn: false,
    content: "const x: number = 42;\n".repeat(20),
    ...overrides,
  };
}

describe("sealPaste / openPaste", () => {
  it("round-trips a paste", async () => {
    const secret = generateSecret();
    const p = paste({ content: "héllo 🌍\n" });
    const sealed = await sealPaste(p, secret);
    expect(sealed[0]).toBe(FORMAT_VERSION);
    expect(await openPaste(sealed, secret)).toEqual(p);
  });

  it("uses a random IV (same input, different output)", async () => {
    const secret = generateSecret();
    const a = await sealPaste(paste(), secret);
    const b = await sealPaste(paste(), secret);
    expect(a).not.toEqual(b);
  });

  it("compresses repetitive content", async () => {
    const p = paste({ content: "a".repeat(10_000) });
    const sealed = await sealPaste(p, generateSecret());
    expect(sealed.length).toBeLessThan(500);
  });

  it("rejects the wrong key with WrongKeyError", async () => {
    const sealed = await sealPaste(paste(), generateSecret());
    await expect(openPaste(sealed, generateSecret())).rejects.toBeInstanceOf(WrongKeyError);
  });

  it("detects tampering of the ciphertext and of the header", async () => {
    const secret = generateSecret();
    const sealed = await sealPaste(paste(), secret);
    const body = sealed.slice();
    body[body.length - 1] = (body[body.length - 1] ?? 0) ^ 1;
    await expect(openPaste(body, secret)).rejects.toBeInstanceOf(WrongKeyError);
    const header = sealed.slice();
    header[1] = (header[1] ?? 0) ^ 0x80;
    await expect(openPaste(header, secret)).rejects.toThrow();
  });

  it("binds additional data (e.g. the nostr author)", async () => {
    const secret = generateSecret();
    const aad = new TextEncoder().encode("author-a");
    const sealed = await sealPaste(paste(), secret, { aad });
    expect(await openPaste(sealed, secret, { aad })).toEqual(paste());
    await expect(
      openPaste(sealed, secret, { aad: new TextEncoder().encode("author-b") }),
    ).rejects.toBeInstanceOf(WrongKeyError);
  });

  it("rejects unknown versions with UnsupportedVersionError", async () => {
    const sealed = await sealPaste(paste(), generateSecret());
    sealed[0] = 99;
    await expect(openPaste(sealed, generateSecret())).rejects.toBeInstanceOf(
      UnsupportedVersionError,
    );
  });

  it("rejects truncated input with CorruptPayloadError", async () => {
    await expect(
      openPaste(new Uint8Array([FORMAT_VERSION, 0, 1]), generateSecret()),
    ).rejects.toBeInstanceOf(CorruptPayloadError);
    await expect(openPaste(new Uint8Array(), generateSecret())).rejects.toBeInstanceOf(
      CorruptPayloadError,
    );
  });

  it("rejects expired pastes client-side with ExpiredError", async () => {
    const secret = generateSecret();
    const sealed = await sealPaste(paste({ expiresAt: 1_000 }), secret);
    await expect(openPaste(sealed, secret, { now: 999 })).resolves.toMatchObject({
      expiresAt: 1_000,
    });
    const err = await openPaste(sealed, secret, { now: 1_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExpiredError);
    expect((err as ExpiredError).expiresAt).toBe(1_000);
  });

  it("refuses content above the size limit with TooLargeError", async () => {
    await expect(
      sealPaste(paste({ content: "x".repeat(3 * 1024 * 1024) }), generateSecret()),
    ).rejects.toBeInstanceOf(TooLargeError);
  });

  describe("with a password", () => {
    it("round-trips and requires both the secret and the password", async () => {
      const secret = generateSecret();
      const sealed = await sealPaste(paste(), secret, { password: "pw", argon: FAST });
      expect(await openPaste(sealed, secret, { password: "pw" })).toEqual(paste());
      await expect(openPaste(sealed, secret, { password: "nope" })).rejects.toBeInstanceOf(
        WrongPasswordError,
      );
      await expect(openPaste(sealed, secret)).rejects.toBeInstanceOf(PasswordRequiredError);
      await expect(openPaste(sealed, generateSecret(), { password: "pw" })).rejects.toBeInstanceOf(
        WrongPasswordError,
      );
    });

    it("refuses absurd argon2 parameters from an untrusted header", async () => {
      const secret = generateSecret();
      const sealed = await sealPaste(paste(), secret, { password: "pw", argon: FAST });
      // header: version, flags, salt(16), memoryKiB u32 BE at offset 18
      new DataView(sealed.buffer).setUint32(18, 0xffffffff);
      await expect(openPaste(sealed, secret, { password: "pw" })).rejects.toBeInstanceOf(
        CorruptPayloadError,
      );
    });
  });
});

describe("link payload", () => {
  it("packs the secret with the sealed paste as base64url", async () => {
    const p = paste();
    const payload = await encodeLinkPayload(p);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeLinkPayload(payload)).toEqual(p);
  });

  it("supports a password", async () => {
    const payload = await encodeLinkPayload(paste(), { password: "s3cret", argon: FAST });
    await expect(decodeLinkPayload(payload)).rejects.toBeInstanceOf(PasswordRequiredError);
    await expect(decodeLinkPayload(payload, { password: "x" })).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
    expect(await decodeLinkPayload(payload, { password: "s3cret" })).toEqual(paste());
  });

  it("rejects garbage", async () => {
    await expect(decodeLinkPayload("!!!")).rejects.toBeInstanceOf(CorruptPayloadError);
    await expect(decodeLinkPayload("AAAA")).rejects.toBeInstanceOf(CorruptPayloadError);
  });

  it("checks expiry", async () => {
    const payload = await encodeLinkPayload(paste({ expiresAt: 5 }));
    await expect(decodeLinkPayload(payload, { now: 6 })).rejects.toBeInstanceOf(ExpiredError);
  });
});
