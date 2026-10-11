import { randomBytes } from "node:crypto";
import { InvariantError } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { VaultCipher } from "./crypto.js";

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
