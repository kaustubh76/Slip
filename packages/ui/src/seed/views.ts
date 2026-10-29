import { DEFAULT_POLICY, type Offer, SYSTEM_DECIDER } from "@slip/domain";
import { offer, snapshot, testAttempt, testDecision } from "@slip/domain/testing";
import { type ReceiptView, renderReceipt } from "@slip/receipt";
import { followUp, hold, payment } from "@slip/receipt/testing";

/** Receipt views as the server sends them, for every state the kit draws. */

const storeA = (price: number, rate = 0): Offer =>
  offer({ price, domain: "store-a.example", rate });
const storeB = (price: number, rate = 0): Offer =>
  offer({ price, domain: "store-b.example", rate });

/** The spec's receipt: $58.99 at Store A against $47.99 at Store B, rejected. */
export function rejectedView(): ReceiptView {
  const chosen = storeA(58.99, 0.08);
  const best = storeB(47.99, 0.02);
  const attempt = testAttempt({
    decision: testDecision({ ruleCode: "R4_OVERPAID", chosen, best, conflict: true }),
  });
  return renderReceipt(
    { attempt, payment: null, hold: null },
    {
      policy: DEFAULT_POLICY,
      snapshot: snapshot({ offers: [chosen, best, storeB(52, 0)] }),
    },
  );
}

export function paidView(): ReceiptView {
  const cheapest = storeB(31.5);
  const attempt = testAttempt({
    decision: testDecision({ ruleCode: "R7_WITHIN_LIMITS", chosen: cheapest, best: cheapest }),
  });
  return renderReceipt(
    { attempt, payment: payment(attempt, "CAPTURED"), hold: null },
    { policy: DEFAULT_POLICY },
  );
}

export function heldView(status: "AUTHORIZED" | "CAPTURING" = "AUTHORIZED"): ReceiptView {
  const attempt = testAttempt({
    decision: testDecision({
      ruleCode: "R6_ABOVE_ORDER_CAP",
      chosen: storeA(239),
      best: storeA(239),
    }),
  });
  return renderReceipt(
    {
      attempt,
      payment: payment(attempt, status),
      hold: hold(attempt, status === "AUTHORIZED" ? "PENDING" : "APPROVED"),
    },
    { policy: DEFAULT_POLICY },
  );
}

export function releasedView(): ReceiptView {
  const attempt = testAttempt({
    decision: testDecision({ ruleCode: "R6_ABOVE_ORDER_CAP", chosen: storeA(239) }),
  });
  return renderReceipt(
    {
      attempt,
      payment: payment(attempt, "VOIDED"),
      hold: hold(attempt, "DECLINED", SYSTEM_DECIDER),
    },
    { policy: DEFAULT_POLICY },
  );
}

export function approvedByFollowUpView(): ReceiptView {
  const attempt = testAttempt({
    decision: testDecision({ ruleCode: "R1_STALE_SNAPSHOT", chosen: null, best: null }),
  });
  return renderReceipt(
    { attempt, payment: null, hold: hold(attempt, "APPROVED") },
    { policy: DEFAULT_POLICY, child: followUp(attempt, "CAPTURED") },
  );
}
