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

/**
 * The key from an `Authorization: Bearer …` header, or null. Every way an agent reaches Slip (the
 * REST checkout, the MCP endpoint) reads it here; the header is the only way in, never a query
 * string or a body field.
 */
export function apiKeyFromHeader(header: string | null): string | null {
  if (header === null) {
    return null;
  }
  const [scheme, ...rest] = header.trim().split(/\s+/);
  const key = rest.join("");
  return scheme?.toLowerCase() === "bearer" && key !== "" ? key : null;
}

/**
 * A v4-shaped UUID derived from `seed`, the same on every call. Used as the PayPal-Request-Id of an
 * operation several callers may each try once (the owner's return from PayPal, the resolver's
 * poll), so PayPal sees one request however many of them get there.
 */
export function derivedUuid(seed: string): string {
  const bytes = createHash("sha256").update(seed, "utf8").digest().subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x40, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
