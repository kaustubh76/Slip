import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { deriveKey, type Env, KEY_PURPOSES, masterKeyFromEnv } from "@slip/db";
import { isUuid } from "@slip/domain";

/**
 * Who is reading the owner's pages, in a cookie the browser cannot forge: the owner id and the
 * mandate they are looking at, signed with HMAC-SHA256 under a key derived for this one purpose
 * (`owner-session-v1`, see `@slip/db`'s `deriveKey`). Nothing secret is in the cookie — the ids
 * are already in every URL — so it is signed, not encrypted; the signature is what matters,
 * because the owner id is what every owner query is scoped by.
 *
 * The cookie is HttpOnly (no script reads it), `SameSite=Lax` (so the owner still arrives signed
 * in when PayPal sends them back), and in production carries the `__Host-` prefix, which the
 * browser only accepts over HTTPS from the root path with no domain of its own.
 */

const VERSION = "v1";
const SEPARATOR = ".";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface OwnerSession {
  ownerId: string;
  mandateId: string;
  /** Unix milliseconds; after this the cookie is ignored however well it is signed. */
  exp: number;
}

/**
 * `v1.<ownerId>.<mandateId>.<exp>.<signature>`. The payload is built from fixed fields in a fixed
 * order (UUIDs and digits, so no part can contain a separator), which leaves nothing for a
 * canonicalisation trick to exploit.
 */
function payloadOf(session: OwnerSession): string {
  return [VERSION, session.ownerId, session.mandateId, String(session.exp)].join(SEPARATOR);
}

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
}

export function signSession(session: OwnerSession, key: Buffer): string {
  const payload = payloadOf(session);
  return `${payload}${SEPARATOR}${sign(payload, key)}`;
}

/** The session this token carries, or null for anything else: forged, stale, or not a token. */
export function verifySession(token: string, key: Buffer, now: number): OwnerSession | null {
  const parts = token.split(SEPARATOR);
  if (parts.length !== 5) {
    return null;
  }
  const [version, ownerId, mandateId, exp, signature] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  if (version !== VERSION || !isUuid(ownerId) || !isUuid(mandateId) || !/^\d{1,15}$/.test(exp)) {
    return null;
  }
  const expected = sign(parts.slice(0, 4).join(SEPARATOR), key);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }
  const expiresAt = Number(exp);
  return expiresAt <= now ? null : { ownerId, mandateId, exp: expiresAt };
}

export interface CookieSpec {
  name: string;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  /** Seconds, as cookies count them. */
  maxAge: number;
}

/**
 * Whether the browser will be on HTTPS, which decides `Secure` and the `__Host-` prefix. It
 * follows `SLIP_BASE_URL` — the address Slip tells PayPal to send the owner back to, so it is the
 * one place that already knows the scheme. A production build with no base URL set assumes HTTPS:
 * a cookie that then fails to arrive is a loud error, where a silently insecure one would not be.
 */
export function secureCookies(env: Env = process.env): boolean {
  const base = env["SLIP_BASE_URL"]?.trim() ?? "";
  if (base.startsWith("https://")) {
    return true;
  }
  if (base.startsWith("http://")) {
    return false;
  }
  return env["NODE_ENV"] === "production";
}

export function sessionCookieName(env: Env = process.env): string {
  // `__Host-` is only accepted over HTTPS, so it would make the cookie unusable on localhost.
  return secureCookies(env) ? "__Host-slip-session" : "slip-session";
}

/** The cookie that carries `session`, with the attributes a session cookie must have. */
export function sessionCookie(
  session: OwnerSession,
  key: Buffer,
  now: number,
  env: Env = process.env,
): CookieSpec {
  return {
    name: sessionCookieName(env),
    value: signSession(session, key),
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(env),
    path: "/",
    maxAge: Math.max(0, Math.floor((session.exp - now) / 1000)),
  };
}

/** The cookie that clears the session. */
export function clearedSessionCookie(env: Env = process.env): CookieSpec {
  return {
    name: sessionCookieName(env),
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(env),
    path: "/",
    maxAge: 0,
  };
}

/** A session for this owner and mandate, valid from `now`. */
export function newSession(
  ownerId: string,
  mandateId: string,
  now: number,
  ttlMs = SESSION_TTL_MS,
): OwnerSession {
  return { ownerId, mandateId, exp: now + ttlMs };
}

/**
 * The signing key for this environment, from `SLIP_ENCRYPTION_KEY`. A demo without that variable
 * gets a key that lasts as long as the process: sessions then do not survive a restart, which is
 * the right trade for a throwaway sandbox. Anywhere else, a missing variable is refused rather
 * than signed around with a key nobody can reproduce.
 */
export function deriveSessionKey(env: Env = process.env): Buffer {
  const configured = env["SLIP_ENCRYPTION_KEY"]?.trim();
  const master =
    (configured === undefined || configured === "") && env["SLIP_DEMO"] === "1"
      ? randomBytes(32)
      : masterKeyFromEnv(env);
  return deriveKey(master, KEY_PURPOSES.ownerSession);
}

/**
 * One signing key for the whole process. It hangs off `globalThis` rather than a module variable
 * because the server is bundled more than once — pages and route handlers end up in separate
 * graphs — and a module-level key would make each of them sign differently. A demo would then
 * accept its own cookie on a page and reject it at an endpoint.
 */
const KEY = Symbol.for("slip.web.sessionKey");
const holder = globalThis as typeof globalThis & { [KEY]?: Buffer };

export function sessionKey(env: Env = process.env): Buffer {
  holder[KEY] ??= deriveSessionKey(env);
  return holder[KEY];
}
