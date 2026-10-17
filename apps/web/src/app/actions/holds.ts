"use server";

import { approveHold, declineHold, previewApproval } from "@slip/app";
import { cents } from "@slip/domain";
import { revalidatePath } from "next/cache";
import { AmountCentsSchema, invalidRequest, ReceiptIdSchema } from "../../server/action-input";
import {
  type DecisionResult,
  decisionResult,
  type PreviewResult,
  previewResult,
} from "../../server/hold-results";
import { requireOwner } from "../../server/owner";

/**
 * The owner's decisions about a hold. Each returns one of three shapes and never throws at the
 * browser: a failure the owner can do nothing about becomes `unknown`, which the dialog reads as
 * "Slip is checking with PayPal", because a decision whose answer was lost may still have moved
 * the money and must not be sent twice.
 */

/** What approving would charge. A `pay` preview asks Channel3 for today's prices, so it is a
 * command the owner triggers, never something a page does on its own. */
export async function previewHoldApproval(id: string): Promise<PreviewResult> {
  const { ownerId, deps } = await requireOwner();
  if (!ReceiptIdSchema.safeParse(id).success) {
    return invalidRequest("receipt");
  }
  try {
    return previewResult(await previewApproval(deps, ownerId, id));
  } catch (error) {
    deps.log.error("web.preview_failed", { attemptId: id, error: String(error) });
    return { status: "unknown" };
  }
}

export async function approve(id: string, expectedAmountCents: number): Promise<DecisionResult> {
  const { ownerId, deps } = await requireOwner();
  const amount = AmountCentsSchema.safeParse(expectedAmountCents);
  if (!ReceiptIdSchema.safeParse(id).success || !amount.success) {
    return invalidRequest("receipt or amount");
  }
  try {
    const result = await approveHold(deps, ownerId, id, {
      expectedAmountCents: cents(amount.data),
    });
    revalidate(id);
    return decisionResult(result);
  } catch (error) {
    deps.log.error("web.approve_failed", { attemptId: id, error: String(error) });
    revalidate(id);
    return { status: "unknown" };
  }
}

export async function decline(id: string): Promise<DecisionResult> {
  const { ownerId, deps } = await requireOwner();
  if (!ReceiptIdSchema.safeParse(id).success) {
    return invalidRequest("receipt");
  }
  try {
    const result = await declineHold(deps, ownerId, id);
    revalidate(id);
    return decisionResult(result);
  } catch (error) {
    deps.log.error("web.decline_failed", { attemptId: id, error: String(error) });
    revalidate(id);
    return { status: "unknown" };
  }
}

/** Re-read on the server too, so the roll and the tray agree with the dialog. */
function revalidate(id: string): void {
  revalidatePath("/receipts");
  revalidatePath(`/receipts/${id}`);
  revalidatePath("/holds");
}
