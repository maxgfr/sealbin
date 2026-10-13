import { getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import {
  deriveBurnSigner,
  deriveNostrId,
  generateOwnerKey,
  generateSecret,
  hashPassword,
  SECRET_BYTES,
} from "./crypto";

const FAST = { memoryKiB: 64, iterations: 1, parallelism: 1 };

describe("crypto", () => {
  it("generates fresh 32-byte secrets", () => {
    const a = generateSecret();
    const b = generateSecret();
    expect(a).toHaveLength(SECRET_BYTES);
    expect(a).not.toEqual(b);
  });

  it("derives a stable 64-char hex nostr id, distinct per secret", async () => {
    const s = new Uint8Array(32).fill(7);
    const id = await deriveNostrId(s);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(await deriveNostrId(s)).toBe(id);
    expect(await deriveNostrId(new Uint8Array(32).fill(8))).not.toBe(id);
  });

  it("derives a burn signer that is a valid secp256k1 key, independent of the nostr id", async () => {
    const s = new Uint8Array(32).fill(1);
    const sk = await deriveBurnSigner(s);
    expect(sk).toHaveLength(32);
    expect(getPublicKey(sk)).toMatch(/^[0-9a-f]{64}$/);
    expect(await deriveBurnSigner(s)).toEqual(sk);
    expect(Buffer.from(sk).toString("hex")).not.toBe(await deriveNostrId(s));
  });

  it("generates valid owner keys", () => {
    const k = generateOwnerKey();
    expect(getPublicKey(k)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes passwords with argon2id deterministically per salt", async () => {
    const salt = new Uint8Array(16).fill(3);
    const h1 = await hashPassword("hunter2", salt, FAST);
    expect(h1).toHaveLength(32);
    expect(await hashPassword("hunter2", salt, FAST)).toEqual(h1);
    expect(await hashPassword("hunter3", salt, FAST)).not.toEqual(h1);
    expect(await hashPassword("hunter2", new Uint8Array(16).fill(4), FAST)).not.toEqual(h1);
  });
});
