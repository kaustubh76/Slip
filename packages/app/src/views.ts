import type { OfferSnapshot, Policy, Receipt } from "@slip/domain";
import { type ReceiptView, renderReceipt } from "@slip/receipt";
import type { AppDeps } from "./deps.js";

/**
 * Renders receipts the way every reader sees them: with the policy version each was decided under,
 * for an approved hold the owner-approval attempt that paid for it, and for a variant mismatch the
 * snapshot that names the listed variant. What the caller already holds (`known`) is not looked up
 * again.
 */
export type Viewer = (
  receipt: Receipt,
  known?: { child?: Receipt | null; snapshot?: OfferSnapshot | null },
) => Promise<ReceiptView>;

/** One viewer per request: each policy version is read once, however many receipts share it. */
export function createViewer(deps: AppDeps): Viewer {
  const policies = new Map<string, Promise<Policy | null>>();
  const policyOf = (receipt: Receipt) => {
    const { mandateId } = receipt.attempt;
    const version = receipt.attempt.decision.checkResult.policyVersion;
    const key = `${mandateId}/${version}`;
    let policy = policies.get(key);
    if (policy === undefined) {
      policy = deps.store.mandates.policy(mandateId, version);
      policies.set(key, policy);
    }
    return policy;
  };

  return async (receipt, known = {}) => {
    const { ruleCode, checkResult } = receipt.attempt.decision;
    const [policy, child, snapshot] = await Promise.all([
      policyOf(receipt),
      known.child !== undefined
        ? known.child
        : receipt.hold?.status === "APPROVED"
          ? deps.store.attempts.findChild(receipt.attempt.id)
          : null,
      known.snapshot !== undefined
        ? known.snapshot
        : ruleCode === "VARIANT_MISMATCH" && checkResult.snapshotId !== null
          ? deps.store.snapshots.get(checkResult.snapshotId)
          : null,
    ]);
    return renderReceipt(receipt, {
      ...(policy === null ? {} : { policy }),
      child,
      snapshot,
      pricesSource: deps.config.pricesSource,
    });
  };
}

/** One receipt, rendered as above. */
export function viewOf(
  deps: AppDeps,
  receipt: Receipt,
  known: { child?: Receipt | null } = {},
): Promise<ReceiptView> {
  return createViewer(deps)(receipt, known);
}
