import type { MandateId } from "@slip/domain";
import type { AppDeps } from "./deps.js";
import { callPayPal } from "./payments.js";

/**
 * Deletes a revoked mandate's vaulted payment method at PayPal and records the confirmation
 * (D29). "Already gone" counts as deleted. A failure or a timeout changes nothing: the mandate
 * stays listed as awaiting deletion and the resolver tries again. The vault id is never logged.
 */
export async function deleteVaultToken(
  deps: AppDeps,
  mandateId: MandateId,
): Promise<"deleted" | "nothing-to-delete" | "failed"> {
  const vaultId = await deps.store.mandates.vaultIdForDeletion(mandateId);
  if (vaultId === null) {
    return "nothing-to-delete";
  }
  const result = await callPayPal(deps, "vault token deletion", (signal) =>
    deps.gateway.deleteVaultToken(vaultId, signal),
  );
  if (result.kind === "failed" || result.kind === "unknown") {
    deps.log.warn("vault.delete_failed", { mandateId, reason: result.reason });
    return "failed";
  }
  await deps.store.mandates.markVaultDeleted(mandateId, deps.clock.now());
  deps.log.info("vault.deleted", { mandateId, paypal: result.kind });
  return "deleted";
}
