import { fileURLToPath } from "node:url";
import { createPgStore, openDatabase, VaultCipher } from "@slip/db";
import type { MandateId } from "@slip/domain";

/**
 * `pnpm -s paypal:vault-id <mandate id>` — prints the PayPal payment token Slip saved for one
 * permission, for `PAYPAL_TEST_VAULT_ID` in the live contract suite. Only the token is printed, so
 * it can be captured without showing it:
 *
 *   PAYPAL_TEST_VAULT_ID=$(pnpm -s paypal:vault-id <id>) pnpm test:live:paypal
 *
 * PGlite takes no lock on its directory, so this refuses while the web app is answering: two
 * processes on one PGlite database can corrupt it.
 */

process.loadEnvFile(fileURLToPath(new URL("../.env.local", import.meta.url)));
const [mandateId] = process.argv.slice(2);
if (mandateId === undefined) {
  console.error(
    "Usage: pnpm -s paypal:vault-id <mandate id>  (the id is on the permission slip page)",
  );
  process.exit(2);
}
const url = process.env["DATABASE_URL"]?.trim() ?? "";
const base = process.env["SLIP_BASE_URL"]?.trim() ?? "http://localhost:3000";
if (url.startsWith("pglite://")) {
  const running = await fetch(base, { signal: AbortSignal.timeout(1_000) }).then(
    () => true,
    () => false,
  );
  if (running) {
    console.error(
      `Slip is running at ${base}; stop it first (PGlite takes no lock on its directory).`,
    );
    process.exit(2);
  }
}
const handle = await openDatabase(url);
try {
  const store = createPgStore(handle.db, VaultCipher.fromEnv(process.env));
  const vaultId = await store.mandates.vaultIdForCharge(mandateId as MandateId);
  if (vaultId === null) {
    console.error("That permission has no saved payment method (not approved, or revoked).");
    process.exitCode = 1;
  } else {
    process.stdout.write(`${vaultId}\n`);
  }
} finally {
  await handle.close();
}
