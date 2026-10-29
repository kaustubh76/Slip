import {
  type Attempt,
  attemptId,
  type Cents,
  type Hold,
  type Payment,
  type PaymentStatus,
  type Receipt,
  requestId,
  SYSTEM_DECIDER,
} from "@slip/domain";
import { minutesFromNow, NOW, offer, testDecision, testUuid } from "@slip/domain/testing";

/** Builders for receipts in any state, shared by the receipt tests. */

/** The attempt's payment in `status`: AUTHORIZE for a HELD attempt, CAPTURE otherwise. */
export function payment(
  attempt: Attempt,
  status: PaymentStatus,
  options: { captureTried?: boolean } = {},
): Payment {
  const intent = attempt.decision.outcome === "HELD" ? "AUTHORIZE" : "CAPTURE";
  return {
    attemptId: attempt.id,
    agentId: attempt.agentId,
    productId: attempt.productId,
    intent,
    status,
    amountCents: (attempt.decision.checkResult.chosen?.priceCents ?? 100) as Cents,
    currency: "USD",
    paypalOrderId: "ORDER-1",
    authorizationId: intent === "AUTHORIZE" ? "AUTH-1" : null,
    captureId: status === "CAPTURED" ? "CAP-1" : null,
    failureReason: status === "FAILED" ? "INSTRUMENT_DECLINED" : null,
    operations: [
      { kind: "ORDER", requestId: requestId(testUuid()), createdAt: NOW },
      ...(options.captureTried
        ? [{ kind: "CAPTURE" as const, requestId: requestId(testUuid()), createdAt: NOW }]
        : []),
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

/** A hold on `attempt`; decided three minutes after NOW unless PENDING. */
export function hold(
  attempt: Attempt,
  status: Hold["status"] = "PENDING",
  decidedBy = "owner-1",
): Hold {
  return {
    attemptId: attempt.id,
    status,
    createdAt: NOW,
    expiresAt: minutesFromNow(48 * 60),
    decidedAt: status === "PENDING" ? null : minutesFromNow(3),
    decidedBy: status === "PENDING" ? null : status === "EXPIRED" ? SYSTEM_DECIDER : decidedBy,
  };
}

/** The owner-approval attempt that paid for `parent`, with its one-step payment. */
export function followUp(parent: Attempt, status: PaymentStatus | null): Receipt {
  const attempt: Attempt = {
    ...parent,
    id: attemptId(testUuid()),
    origin: "OWNER_APPROVAL",
    parentAttemptId: parent.id,
    decision: testDecision({ ruleCode: "OWNER_APPROVED", chosen: offer({ price: 250 }) }),
  };
  return { attempt, payment: status === null ? null : payment(attempt, status), hold: null };
}
