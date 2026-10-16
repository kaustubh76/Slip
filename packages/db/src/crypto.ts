import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { InvariantError } from "@slip/domain";

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const MASTER_BYTES = 32;
const DERIVED_BYTES = 32;

/**
 * Never change this salt, and never change a purpose string below: both go into the key, so a
 * changed byte silently derives a different key and every vault id already stored stops
 * decrypting. A new use gets a new purpose; a key that must be rotated gets a new `-v2` purpose.
 */
const SALT = Buffer.from("slip");

/** Every key Slip derives from the one master key, one per use. */
export const KEY_PURPOSES = {
  /** AES-256-GCM over a PayPal vault id, bound to its mandate. */
  vaultEncryption: "vault-id-encryption-v1",
  /** HMAC over a vault id, so a webhook can find its mandate without decrypting every row. */
  vaultBlindIndex: "vault-id-blind-index-v1",
  /** HMAC over the owner's session cookie. */
  ownerSession: "owner-session-v1",
} as const;
export type KeyPurpose = (typeof KEY_PURPOSES)[keyof typeof KEY_PURPOSES];

function assertMasterKey(master: Buffer): Buffer {
  if (master.length !== MASTER_BYTES) {
    throw new InvariantError(
      `SLIP_ENCRYPTION_KEY must be ${MASTER_BYTES} bytes, got ${master.length}`,
    );
  }
  return master;
}

/**
 * One key per purpose (HKDF-SHA256), all from the single master key `SLIP_ENCRYPTION_KEY`. Keys
 * for different purposes are independent: learning one says nothing about the others, so the
 * cookie signature cannot be used against a stored vault id or the other way round.
 */
export function deriveKey(master: Buffer, purpose: KeyPurpose): Buffer {
  return Buffer.from(
    hkdfSync("sha256", assertMasterKey(master), SALT, Buffer.from(purpose), DERIVED_BYTES),
  );
}

/**
 * Just the variables, as every runtime has them: `process.env` fits, and so does a plain object
 * in a test or an edge runtime that types `NODE_ENV` more strictly.
 */
export type Env = Readonly<Record<string, string | undefined>>;

/** The master key from base64 (or base64url), as produced by `openssl rand -base64 32`. */
export function masterKeyFromBase64(key: string): Buffer {
  return assertMasterKey(Buffer.from(key.trim(), "base64"));
}

/** The master key from `SLIP_ENCRYPTION_KEY`; refuses to start without it. */
export function masterKeyFromEnv(env: Env = process.env): Buffer {
  const key = env["SLIP_ENCRYPTION_KEY"];
  if (key === undefined || key.trim() === "") {
    throw new InvariantError("SLIP_ENCRYPTION_KEY is not set");
  }
  return masterKeyFromBase64(key);
}

/**
 * Protects PayPal vault ids at rest. The vault id is what lets Slip charge the owner, so it is
 * never stored in plaintext:
 *
 * - `encrypt` is AES-256-GCM with the mandate id as additional authenticated data, so a
 *   ciphertext copied onto another mandate's row fails to decrypt instead of charging the wrong
 *   owner's method. Format: `v1.<iv>.<tag>.<ciphertext>`, base64url; the version prefix leaves
 *   room for key rotation.
 * - `blindIndex` is an HMAC of the vault id, so a VAULT.PAYMENT-TOKEN webhook can find its
 *   mandate without decrypting every row.
 *
 * Both keys come from `deriveKey`, so they are independent of each other and of every other key
 * Slip derives from the same master (`SLIP_ENCRYPTION_KEY`).
 */
export class VaultCipher {
  readonly #encryptionKey: Buffer;
  readonly #indexKey: Buffer;

  private constructor(master: Buffer) {
    this.#encryptionKey = deriveKey(master, KEY_PURPOSES.vaultEncryption);
    this.#indexKey = deriveKey(master, KEY_PURPOSES.vaultBlindIndex);
  }

  /** From a base64 (or base64url) 32-byte key, as produced by `openssl rand -base64 32`. */
  static fromBase64Key(key: string): VaultCipher {
    return new VaultCipher(masterKeyFromBase64(key));
  }

  /** From `SLIP_ENCRYPTION_KEY`; refuses to start without it. */
  static fromEnv(env: Env = process.env): VaultCipher {
    return new VaultCipher(masterKeyFromEnv(env));
  }

  /** A throwaway key, for tests and local PGlite databases. */
  static random(): VaultCipher {
    return new VaultCipher(randomBytes(MASTER_BYTES));
  }

  encrypt(vaultId: string, mandateId: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#encryptionKey, iv, {
      authTagLength: TAG_BYTES,
    });
    cipher.setAAD(Buffer.from(mandateId));
    const body = Buffer.concat([cipher.update(vaultId, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv, tag, body]
      .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
      .join(".");
  }

  decrypt(ciphertext: string, mandateId: string): string {
    const parts = ciphertext.split(".");
    const [version, iv, tag, body] = parts;
    if (parts.length !== 4 || version !== VERSION || !iv || !tag || body === undefined) {
      throw new InvariantError("vault id ciphertext is malformed");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#encryptionKey,
        Buffer.from(iv, "base64url"),
        { authTagLength: TAG_BYTES },
      );
      decipher.setAAD(Buffer.from(mandateId));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(body, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch (cause) {
      throw new InvariantError("vault id did not decrypt for this mandate", { cause });
    }
  }

  blindIndex(vaultId: string): string {
    return createHmac("sha256", this.#indexKey).update(vaultId, "utf8").digest("base64url");
  }

  /** Constant-time comparison of a vault id against a stored blind index. */
  matches(vaultId: string, index: string): boolean {
    const a = Buffer.from(this.blindIndex(vaultId));
    const b = Buffer.from(index);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
