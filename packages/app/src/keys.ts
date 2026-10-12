import { createHash, randomBytes } from "node:crypto";

/** Agent API keys: `slip_live_` + 32 random bytes (base64url). Only the SHA-256 hash is stored. */
export const API_KEY_PREFIX = "slip_live_";
const SHOWN_CHARACTERS = 14;

export interface IssuedKey {
  /** Shown once, to the owner, when the key is created. Never stored. */
  key: string;
  hash: string;
  /** The first characters, so the owner can recognise a key in a list. */
  prefix: string;
}

export function generateApiKey(): IssuedKey {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, hash: hashApiKey(key), prefix: key.slice(0, SHOWN_CHARACTERS) };
}

/**
 * A plain SHA-256: the key has 256 bits of randomness, so no salt or slow hash is needed, and a
 * lookup by hash is a single indexed read.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key.trim(), "utf8").digest("hex");
}
