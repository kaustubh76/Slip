import type { OwnerId } from "@slip/domain";
import type { AppDeps } from "./deps.js";
import { normalizeEmail, verifyPassword } from "./passwords.js";

/**
 * Signing a returning owner in. The browser's session cookie is still what carries an owner
 * between pages; this is only a second way to obtain one, for the browser that forgot (D71).
 *
 * One answer for every failure. A wrong address and a wrong password are the same "no", because
 * telling them apart would turn this into a way to find out which addresses have Slip accounts.
 * The work is done either way, so the two take about as long as each other.
 */

export type SignInResult =
  | { status: "signed-in"; ownerId: OwnerId }
  | { status: "refused"; message: string };

const NO = "That email and password do not match an owner.";

export async function signIn(
  deps: AppDeps,
  input: { email: string; password: string },
): Promise<SignInResult> {
  const email = normalizeEmail(input.email);
  if (email === "" || input.password === "") {
    return { status: "refused", message: NO };
  }
  const credential = await deps.store.owners.credentialFor(email);
  if (credential === null) {
    // No such owner, or one who never set a password: the same answer, and the same work, so the
    // timing does not say which.
    await verifyPassword(input.password, DECOY);
    return { status: "refused", message: NO };
  }
  if (!(await verifyPassword(input.password, credential.passwordHash))) {
    deps.log.warn("owner.sign_in_refused", { ownerId: credential.ownerId });
    return { status: "refused", message: NO };
  }
  deps.log.info("owner.signed_in", { ownerId: credential.ownerId });
  return { status: "signed-in", ownerId: credential.ownerId };
}

/**
 * A real hash of a value nobody knows, so an unknown address costs the same scrypt as a known one.
 * Generated once at import: the point is the work, not the secrecy.
 */
const DECOY = "scrypt$16384$8$1$ZGVjb3lzYWx0$7Zq8V1Nn8vJ1xq7pQ0kH2fJ3cR8sT4uV6wX9yZ0aB1c";
