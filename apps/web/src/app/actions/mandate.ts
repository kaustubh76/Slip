"use server";

import { revokeMandate, startMandate } from "@slip/app";
import { revalidatePath } from "next/cache";
import { RevokeWordSchema } from "../../server/action-input";
import { requireOwner, startSession } from "../../server/owner";

export type SetupResult =
  | { status: "started"; approveUrl: string }
  | { status: "refused"; reason: string; message: string }
  | { status: "unknown" };

export type RevokeMandateResult =
  | { status: "revoked"; holdsDeclined: number; vault: "deleted" | "nothing-to-delete" | "failed" }
  | { status: "refused"; reason: string; message: string }
  | { status: "unknown" };

/**
 * A new permission slip: Slip asks PayPal for the link where the owner approves saving their
 * payment method, and the session follows the new mandate so the pages show it.
 */
export async function beginSetup(): Promise<SetupResult> {
  const { ownerId, deps } = await requireOwner();
  try {
    const result = await startMandate(deps, ownerId, {});
    if (result.status === "refused") {
      return { status: "refused", reason: result.reason, message: result.message };
    }
    await startSession(ownerId, result.mandate.id);
    revalidatePath("/mandate");
    return { status: "started", approveUrl: result.approveUrl };
  } catch (error) {
    deps.log.error("web.setup_failed", { ownerId, error: String(error) });
    return { status: "unknown" };
  }
}

/**
 * The kill switch. The owner types the word, and Slip stops: the mandate is revoked first, so
 * every charge and approval is refused from that moment, then open holds are released and the
 * saved method is deleted at PayPal. Anything left over is finished by the resolver.
 */
export async function revokeTheMandate(typed: string): Promise<RevokeMandateResult> {
  const { ownerId, mandateId, deps } = await requireOwner();
  if (!RevokeWordSchema.safeParse(typed).success || typed.trim().toUpperCase() !== "REVOKE") {
    return {
      status: "refused",
      reason: "NOT_CONFIRMED",
      message: "Type REVOKE to confirm, or leave this alone.",
    };
  }
  try {
    const result = await revokeMandate(deps, ownerId, mandateId);
    return result.status === "refused"
      ? { status: "refused", reason: result.reason, message: result.message }
      : { status: "revoked", holdsDeclined: result.holdsDeclined, vault: result.vault };
  } catch (error) {
    deps.log.error("web.revoke_failed", { mandateId, error: String(error) });
    return { status: "unknown" };
  }
}
