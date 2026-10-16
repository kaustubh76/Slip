import type { AttemptId } from "./ids.js";
import type { Payment } from "./payment.js";
import type { Transitions } from "./state-machine.js";

/** A HELD attempt waits for its owner. No decision within the TTL → expired → hold released. */
export const HOLD_STATUSES = ["PENDING", "APPROVED", "DECLINED", "EXPIRED"] as const;
export type HoldStatus = (typeof HOLD_STATUSES)[number];

export const HOLD_TRANSITIONS: Transitions<HoldStatus> = {
  PENDING: ["APPROVED", "DECLINED", "EXPIRED"],
  APPROVED: [],
  DECLINED: [],
  EXPIRED: [],
};

/** 48 hours; well inside PayPal's 3-day honor period for an authorization. */
export const DEFAULT_HOLD_TTL_MS = 48 * 60 * 60 * 1000;

/** Who decided an expired hold. */
export const SYSTEM_DECIDER = "system";

export interface Hold {
  attemptId: AttemptId;
  status: HoldStatus;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
}

/**
 * How a PENDING hold can be approved, decided by its payment alone — the one rule the store, the
 * application and the receipt share (D27):
 * - `capture`: PayPal holds the money (AUTHORIZED); approving captures it.
 * - `pay`: nothing is reserved — no order was placed, or PayPal failed or voided the authorization
 *   before any capture — so approving checks again and pays in one step with a follow-up attempt.
 * - `not-ready`: PayPal has not confirmed the authorization yet; ask again shortly.
 * - `spent`: a capture was already tried, or is under way; the approval cannot be given again.
 */
export type ApprovalPath = "capture" | "pay" | "not-ready" | "spent";

export function approvalPath(payment: Payment | null): ApprovalPath {
  if (payment === null) {
    return "pay";
  }
  const captureTried = payment.operations.some((op) => op.kind === "CAPTURE");
  switch (payment.status) {
    case "AUTHORIZED":
      return "capture";
    case "FAILED":
    case "VOIDED":
      return captureTried ? "spent" : "pay";
    case "INITIATED":
    case "UNKNOWN":
    case "PENDING":
      return "not-ready";
    default:
      return "spent";
  }
}
