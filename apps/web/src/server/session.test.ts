import { randomBytes, randomUUID } from "node:crypto";
import { InvariantError } from "@slip/domain";
import { describe, expect, it } from "vitest";
import {
  clearedSessionCookie,
  deriveSessionKey,
  newSession,
  SESSION_TTL_MS,
  sessionCookie,
  sessionCookieName,
  sessionKey,
  signSession,
  verifySession,
} from "./session";

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const NOW = Date.UTC(2026, 9, 16, 14, 2);
const session = () => newSession(randomUUID(), randomUUID(), NOW);

describe("the session token", () => {
  it("carries the owner and mandate back, signed", () => {
    const mine = session();
    const token = signSession(mine, KEY);
    expect(verifySession(token, KEY, NOW)).toEqual(mine);
    expect(mine.exp).toBe(NOW + SESSION_TTL_MS);
  });

  it("is refused once it expires, however well it is signed", () => {
    const token = signSession(session(), KEY);
    expect(verifySession(token, KEY, NOW + SESSION_TTL_MS - 1)).not.toBeNull();
    expect(verifySession(token, KEY, NOW + SESSION_TTL_MS)).toBeNull();
    expect(verifySession(token, KEY, NOW + SESSION_TTL_MS + 1)).toBeNull();
  });

  it("is refused under another key", () => {
    expect(verifySession(signSession(session(), KEY), OTHER_KEY, NOW)).toBeNull();
  });

  it("cannot be edited: every tampered field is refused", () => {
    const mine = session();
    const token = signSession(mine, KEY);
    const [version, ownerId, mandateId, exp, signature] = token.split(".") as string[];
    const forged = [
      // Someone else's receipts.
      [version, randomUUID(), mandateId, exp, signature],
      // Another mandate under the same owner.
      [version, ownerId, randomUUID(), exp, signature],
      // A longer life.
      [version, ownerId, mandateId, String(NOW + 10 * SESSION_TTL_MS), signature],
      // A signature from nowhere.
      [version, ownerId, mandateId, exp, randomBytes(32).toString("base64url")],
      // A version Slip does not issue.
      ["v2", ownerId, mandateId, exp, signature],
    ];
    for (const parts of forged) {
      expect(verifySession(parts.join("."), KEY, NOW), parts.join(".")).toBeNull();
    }
    // The untouched token still works, so the test is proving tampering and not a typo.
    expect(verifySession(token, KEY, NOW)).toEqual(mine);
  });

  it("refuses anything that is not a token", () => {
    for (const bad of [
      "",
      "garbage",
      "v1.not-a-uuid.also-not.123.sig",
      signSession(session(), KEY).split(".").slice(0, 4).join("."),
      `${signSession(session(), KEY)}.extra`,
      `v1.${randomUUID()}.${randomUUID()}.not-a-number.sig`,
    ]) {
      expect(verifySession(bad, KEY, NOW), bad).toBeNull();
    }
  });

  it("an owner with no session at all is just no session", () => {
    expect(verifySession("", KEY, NOW)).toBeNull();
  });
});

describe("the session cookie", () => {
  it("is HttpOnly, Lax and lasts as long as the session", () => {
    const mine = session();
    const cookie = sessionCookie(mine, KEY, NOW, { SLIP_BASE_URL: "http://localhost:3000" });
    expect(cookie).toMatchObject({
      name: "slip-session",
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
    expect(verifySession(cookie.value, KEY, NOW)).toEqual(mine);
  });

  it("on HTTPS it is Secure and host-locked", () => {
    const cookie = sessionCookie(session(), KEY, NOW, { SLIP_BASE_URL: "https://slip.example" });
    expect(cookie.name).toBe("__Host-slip-session");
    expect(cookie.secure).toBe(true);
    // The browser only accepts the prefix from the root path with no domain of its own.
    expect(cookie.path).toBe("/");
  });

  it("follows the address PayPal returns to, so a local server over http still works", () => {
    // `next start` sets NODE_ENV=production; a demo on http would never receive a Secure cookie.
    const local = { NODE_ENV: "production", SLIP_BASE_URL: "http://localhost:3000" } as const;
    expect(sessionCookieName(local)).toBe("slip-session");
    expect(sessionCookie(session(), KEY, NOW, local).secure).toBe(false);
    // Deployed with no base URL set, it assumes HTTPS rather than quietly dropping Secure.
    expect(sessionCookieName({ NODE_ENV: "production" })).toBe("__Host-slip-session");
    expect(sessionCookieName({})).toBe("slip-session");
  });

  it("never asks the browser to keep an expired session", () => {
    const stale = newSession(randomUUID(), randomUUID(), NOW - 2 * SESSION_TTL_MS);
    expect(sessionCookie(stale, KEY, NOW, {}).maxAge).toBe(0);
  });

  it("signing out clears the same cookie", () => {
    const env = { SLIP_BASE_URL: "https://slip.example" };
    const cleared = clearedSessionCookie(env);
    expect(cleared.name).toBe(sessionCookieName(env));
    expect(cleared).toMatchObject({ value: "", maxAge: 0, httpOnly: true });
  });
});

describe("the signing key", () => {
  it("comes from SLIP_ENCRYPTION_KEY, the same way every time", () => {
    const key = randomBytes(32).toString("base64");
    const derived = deriveSessionKey({ SLIP_ENCRYPTION_KEY: key });
    expect(derived).toHaveLength(32);
    expect(deriveSessionKey({ SLIP_ENCRYPTION_KEY: key })).toEqual(derived);
    // It signs with a key of its own, never the master key.
    expect(derived.toString("base64")).not.toBe(key);
  });

  it("refuses to sign without a key, unless this is a demo", () => {
    expect(() => deriveSessionKey({})).toThrow(InvariantError);
    expect(() => deriveSessionKey({ SLIP_ENCRYPTION_KEY: "  " })).toThrow(InvariantError);
    const demo = deriveSessionKey({ SLIP_DEMO: "1" });
    expect(demo).toHaveLength(32);
    // A throwaway key, so two demos never share one.
    expect(deriveSessionKey({ SLIP_DEMO: "1" })).not.toEqual(demo);
  });

  it("does not fall back to a throwaway key where demos are refused (Vercel)", () => {
    // Each instance would sign with its own random key and reject the others' cookies.
    expect(() => deriveSessionKey({ SLIP_DEMO: "1", VERCEL: "1" })).toThrow(InvariantError);
  });

  it("is derived once for the whole process, not once per bundle", () => {
    const key = randomBytes(32).toString("base64");
    const first = sessionKey({ SLIP_ENCRYPTION_KEY: key });
    expect(sessionKey({ SLIP_ENCRYPTION_KEY: randomBytes(32).toString("base64") })).toBe(first);
    // It is shared through globalThis, so a page and an endpoint in separate bundles — each with
    // its own copy of this module — still sign and verify the same way.
    const shared = (globalThis as Record<symbol, unknown>)[Symbol.for("slip.web.sessionKey")];
    expect(shared).toBe(first);
  });
});
