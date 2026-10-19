import {
  randomBytes,
  type ScryptOptions,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

/**
 * An owner's password, hashed so that holding the database does not hand someone the kill switch.
 *
 * `scrypt` from Node's own crypto, with a per-owner salt. No dependency to audit, and no email
 * service to sign up for: a password is the only credential Slip can issue entirely by itself,
 * which is what makes a returning owner possible at all (D71).
 *
 * The stored string carries its own parameters — `scrypt$N$r$p$salt$key` — so the cost can be
 * raised later and old hashes still verify. The comparison is constant time: a timing difference
 * would leak how much of a guess was right.
 *
 * What this is not: a password reset. Slip cannot send email, so a forgotten password cannot be
 * recovered, and the sign-up page says so rather than implying otherwise.
 */

/** Wrapped by hand rather than with `promisify`, which loses the options overload. */
const scrypt = (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, key) => {
      if (error === null) {
        resolve(key);
      } else {
        reject(error);
      }
    });
  });

/** ~60 ms on a 2026 laptop: slow enough to be worth little stolen, fast enough for a form post. */
const COST = { N: 16_384, r: 8, p: 1 } as const;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

/** Below this a password is not worth hashing; the page says so before anything is stored. */
export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`a password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_BYTES, COST);
  return [
    "scrypt",
    COST.N,
    COST.r,
    COST.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** True when `password` produced `stored`. False for anything unparsable — never a throw. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") {
    return false;
  }
  const [, n, r, p, salt, expected] = parts;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
    return false;
  }
  const want = Buffer.from(expected ?? "", "base64url");
  if (want.length === 0) {
    return false;
  }
  let key: Buffer;
  try {
    key = await scrypt(
      password.normalize("NFKC"),
      Buffer.from(salt ?? "", "base64url"),
      want.length,
      cost,
    );
  } catch {
    return false;
  }
  // Lengths must match before a constant-time compare, and a mismatch is not a secret.
  return key.length === want.length && timingSafeEqual(key, want);
}

/** One spelling per address, so two owners cannot differ by capitals alone. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
