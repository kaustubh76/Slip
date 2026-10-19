import { describe, expect, it } from "vitest";
import { hashPassword, MIN_PASSWORD_LENGTH, normalizeEmail, verifyPassword } from "./passwords.js";

/** The only credential Slip issues itself, so the failure modes are the test. */

describe("hashing an owner's password", () => {
  it("verifies the right password and refuses a wrong one", async () => {
    const stored = await hashPassword("a reasonable passphrase");
    expect(await verifyPassword("a reasonable passphrase", stored)).toBe(true);
    expect(await verifyPassword("a reasonable passphras", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("never stores the password, and salts every owner differently", async () => {
    const first = await hashPassword("a reasonable passphrase");
    const second = await hashPassword("a reasonable passphrase");
    expect(first).not.toContain("passphrase");
    // Same password, different stored value: the database alone cannot group owners by password.
    expect(first).not.toBe(second);
    expect(await verifyPassword("a reasonable passphrase", second)).toBe(true);
  });

  it("carries its own parameters, so the cost can be raised later", async () => {
    const stored = await hashPassword("a reasonable passphrase");
    expect(stored.split("$").slice(0, 4)).toEqual(["scrypt", "16384", "8", "1"]);
  });

  it("refuses to hash a password too short to be worth hashing", async () => {
    await expect(hashPassword("short")).rejects.toThrow(String(MIN_PASSWORD_LENGTH));
  });

  it("treats the same characters written two ways as the same password", async () => {
    // "é" composed and decomposed: a password typed on another keyboard still signs in.
    const stored = await hashPassword("passphrase café!!");
    expect(await verifyPassword("passphrase café!!", stored)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["not-a-hash", "unparsable"],
    ["scrypt$1$2$3$4", "too few parts"],
    ["bcrypt$16384$8$1$c2FsdA$a2V5", "another scheme"],
    ["scrypt$x$8$1$c2FsdA$a2V5", "a non-numeric cost"],
  ])("refuses a stored value that is %s (%s) rather than throwing", async (stored) => {
    expect(await verifyPassword("a reasonable passphrase", stored)).toBe(false);
  });
});

describe("one spelling per address", () => {
  it.each([
    ["Owner@Example.com", "owner@example.com"],
    ["  owner@example.com  ", "owner@example.com"],
    ["OWNER@EXAMPLE.COM", "owner@example.com"],
  ])("%s is stored as %s", (input, expected) => {
    expect(normalizeEmail(input)).toBe(expected);
  });
});
