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

function deriveKey(master: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", master, Buffer.from("slip"), Buffer.from(purpose), 32));
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
 * Both keys are derived (HKDF-SHA256) from one 32-byte master key, `SLIP_ENCRYPTION_KEY`.
 */
export class VaultCipher {
  readonly #encryptionKey: Buffer;
  readonly #indexKey: Buffer;

  private constructor(master: Buffer) {
    if (master.length !== 32) {
      throw new InvariantError(`SLIP_ENCRYPTION_KEY must be 32 bytes, got ${master.length}`);
    }
    this.#encryptionKey = deriveKey(master, "vault-id-encryption-v1");
    this.#indexKey = deriveKey(master, "vault-id-blind-index-v1");
  }

  /** From a base64 (or base64url) 32-byte key, as produced by `openssl rand -base64 32`. */
  static fromBase64Key(key: string): VaultCipher {
    return new VaultCipher(Buffer.from(key.trim(), "base64"));
  }

  /** From `SLIP_ENCRYPTION_KEY`; refuses to start without it. */
  static fromEnv(env: NodeJS.ProcessEnv = process.env): VaultCipher {
    const key = env["SLIP_ENCRYPTION_KEY"];
    if (key === undefined || key.trim() === "") {
      throw new InvariantError("SLIP_ENCRYPTION_KEY is not set");
    }
    return VaultCipher.fromBase64Key(key);
  }

  /** A throwaway key, for tests and local PGlite databases. */
  static random(): VaultCipher {
    return new VaultCipher(randomBytes(32));
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
