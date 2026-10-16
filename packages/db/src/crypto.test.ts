import { randomBytes } from "node:crypto";
import { InvariantError } from "@slip/domain";
import { describe, expect, it } from "vitest";
import {
  deriveKey,
  KEY_PURPOSES,
  masterKeyFromBase64,
  masterKeyFromEnv,
  VaultCipher,
} from "./crypto.js";

const KEY = randomBytes(32).toString("base64");

describe("VaultCipher", () => {
  const cipher = VaultCipher.fromBase64Key(KEY);

  it("round-trips a vault id and never repeats a ciphertext", () => {
    const a = cipher.encrypt("8kk8451t", "mandate-1");
    const b = cipher.encrypt("8kk8451t", "mandate-1");
    expect(a).not.toBe(b);
    expect(a.split(".")).toHaveLength(4);
    expect(cipher.decrypt(a, "mandate-1")).toBe("8kk8451t");
    expect(cipher.decrypt(b, "mandate-1")).toBe("8kk8451t");
  });

  it("is bound to its mandate: another mandate id does not decrypt it", () => {
    const ciphertext = cipher.encrypt("8kk8451t", "mandate-1");
    expect(() => cipher.decrypt(ciphertext, "mandate-2")).toThrow(InvariantError);
  });

  it("detects tampering and a wrong key", () => {
    const ciphertext = cipher.encrypt("8kk8451t", "mandate-1");
    const [v, iv, tag, body] = ciphertext.split(".");
    const flipped = `${v}.${iv}.${tag}.${(body ?? "").replace(/^./, (c) => (c === "A" ? "B" : "A"))}`;
    expect(() => cipher.decrypt(flipped, "mandate-1")).toThrow(InvariantError);
    expect(() => VaultCipher.random().decrypt(ciphertext, "mandate-1")).toThrow(InvariantError);
    expect(() => cipher.decrypt("v2.a.b.c", "mandate-1")).toThrow(InvariantError);
    expect(() => cipher.decrypt("garbage", "mandate-1")).toThrow(InvariantError);
  });

  it("the blind index is stable for one key and differs across keys", () => {
    const same = VaultCipher.fromBase64Key(KEY);
    expect(cipher.blindIndex("8kk8451t")).toBe(same.blindIndex("8kk8451t"));
    expect(cipher.blindIndex("8kk8451t")).not.toBe(VaultCipher.random().blindIndex("8kk8451t"));
    expect(cipher.blindIndex("8kk8451t")).not.toContain("8kk8451t");
    expect(cipher.matches("8kk8451t", cipher.blindIndex("8kk8451t"))).toBe(true);
    expect(cipher.matches("other", cipher.blindIndex("8kk8451t"))).toBe(false);
  });

  it("refuses a missing or short key", () => {
    expect(() => VaultCipher.fromBase64Key(randomBytes(16).toString("base64"))).toThrow(
      InvariantError,
    );
    expect(() => VaultCipher.fromEnv({})).toThrow(InvariantError);
    expect(() => VaultCipher.fromEnv({ SLIP_ENCRYPTION_KEY: KEY })).not.toThrow();
  });
});

describe("deriveKey", () => {
  const master = Buffer.alloc(32, 7);

  /**
   * Known answers for a fixed master key, computed from the formula Slip has always used
   * (HKDF-SHA256, salt "slip", the purpose as info, 32 bytes). If one of these changes, every
   * vault id already stored stops decrypting and every blind index stops matching, so a failure
   * here means the salt, a purpose string or the length moved — not that the test is stale.
   */
  it.each([
    [
      KEY_PURPOSES.vaultEncryption,
      "63fc4113ffe6eb2acd23f6bb64d63b3e4a66d2ba79746715667c9d0aa737e35a",
    ],
    [
      KEY_PURPOSES.vaultBlindIndex,
      "86af3129c1835980015304b4faaa50346d3419cdff002097c4141891a84f35cd",
    ],
    [KEY_PURPOSES.ownerSession, "0df4eb4eea742935b5b5649d9a56ec2f3f0e041f6d322a7e11f5469e06c4353f"],
  ])("%s derives the key it always has", (purpose, expected) => {
    expect(deriveKey(master, purpose).toString("hex")).toBe(expected);
  });

  it("gives every purpose its own independent 32-byte key", () => {
    const purposes = Object.values(KEY_PURPOSES);
    expect(new Set(purposes).size).toBe(purposes.length);
    const keys = purposes.map((purpose) => deriveKey(master, purpose).toString("hex"));
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key).toHaveLength(64);
    }
  });

  it("is the same for one master key and different for another", () => {
    const purpose = KEY_PURPOSES.ownerSession;
    expect(deriveKey(master, purpose)).toEqual(deriveKey(Buffer.alloc(32, 7), purpose));
    expect(deriveKey(master, purpose)).not.toEqual(deriveKey(randomBytes(32), purpose));
  });

  it("refuses a master key that is not 32 bytes", () => {
    expect(() => deriveKey(Buffer.alloc(16), KEY_PURPOSES.ownerSession)).toThrow(InvariantError);
    expect(() => masterKeyFromBase64(randomBytes(31).toString("base64"))).toThrow(InvariantError);
  });

  it("reads the master key from the environment, or refuses to start", () => {
    expect(masterKeyFromEnv({ SLIP_ENCRYPTION_KEY: KEY })).toEqual(masterKeyFromBase64(KEY));
    expect(() => masterKeyFromEnv({})).toThrow(InvariantError);
    expect(() => masterKeyFromEnv({ SLIP_ENCRYPTION_KEY: "  " })).toThrow(InvariantError);
  });
});
