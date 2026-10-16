import { DEFAULT_POLICY, type PaymentStatus, RULE_CODES } from "@slip/domain";
import { offer, testAttempt, testDecision } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { hold, payment } from "./__fixtures__/receipts.js";
import { renderReceipt } from "./view.js";

const storeA = (price: number, rate = 0) => offer({ price, domain: "store-a.example", rate });
const storeB = (price: number, rate = 0) => offer({ price, domain: "store-b.example", rate });

describe("renderReceipt", () => {
  it("the spec's rejected receipt, word for word", () => {
    const attempt = testAttempt({
      decision: testDecision({
        ruleCode: "R4_OVERPAID",
        chosen: storeA(58.99, 0.08),
        best: storeB(47.99, 0.02),
        conflict: true,
      }),
    });
    const view = renderReceipt({ attempt, payment: null, hold: null }, { policy: DEFAULT_POLICY });
    expect(view.lines).toEqual([
      "Your agent tried to pay $58.99 at store-a.example.",
      "The same item was listed at $47.99 at store-b.example.",
      "Overpaid by $11.00 (23%).",
      "store-a.example pays your agent's platform up to 8% commission; store-b.example pays up to 2%.",
      "The price was more than 5% and $8.00 above the lowest listed price.",
      "Payment rejected. Nothing was charged.",
      "Listed item prices from Channel3 at 14:02 UTC. Shipping and tax are not included.",
    ]);
    expect(view).toMatchObject({ outcome: "REJECTED", charged: false, paymentStatus: "NONE" });
    expect(view.gap).toEqual({ cents: 1100, amount: "$11.00", percent: "23%" });
  });

  it("a paid purchase at the lowest price", () => {
    const cheapest = storeB(47.99);
    const attempt = testAttempt({
      decision: testDecision({ ruleCode: "R7_WITHIN_LIMITS", chosen: cheapest, best: cheapest }),
    });
    const view = renderReceipt({ attempt, payment: payment(attempt, "CAPTURED"), hold: null });
    expect(view.lines).toEqual([
      "Your agent tried to pay $47.99 at store-b.example.",
      "That is the lowest listed price for this item.",
      "The price is within your limits.",
      "Paid $47.99 at store-b.example.",
      "Listed item prices from Channel3 at 14:02 UTC. Shipping and tax are not included.",
    ]);
    expect(view.charged).toBe(true);
    expect(view.paypal).toEqual({ orderId: "ORDER-1", authorizationId: null, captureId: "CAP-1" });
  });

  it("a hold above the order limit, with the money reserved", () => {
    const attempt = testAttempt({
      decision: testDecision({
        ruleCode: "R6_ABOVE_ORDER_CAP",
        chosen: storeA(250),
        best: storeB(249),
      }),
    });
    const view = renderReceipt(
      { attempt, payment: payment(attempt, "AUTHORIZED"), hold: hold(attempt) },
      { policy: DEFAULT_POLICY },
    );
    expect(view.lines).toContain("The order is above your $200.00 order limit.");
    expect(view.lines).toContain(
      "$250.00 is reserved, not charged, until you decide (by 13 Oct 14:02 UTC).",
    );
    expect(view.charged).toBe(false);
    expect(view.state).toMatchObject({ word: "AUTHORIZED", charged: false, inFlight: false });
  });

  it("a hold with no prices says so, and that nothing was reserved", () => {
    const attempt = testAttempt({
      decision: testDecision({
        ruleCode: "R1_STALE_SNAPSHOT",
        chosen: null,
        best: null,
        snapshotId: null,
      }),
    });
    const view = renderReceipt({
      attempt: {
        ...attempt,
        decision: {
          ...attempt.decision,
          checkResult: { ...attempt.decision.checkResult, snapshotFetchedAt: null },
        },
      },
      payment: null,
      hold: hold(attempt),
    });
    expect(view.lines).toEqual([
      "Slip could not get current prices for this item, so it held the purchase for you.",
      "Nothing is reserved. Approving checks again at current listed prices and pays in one step.",
      "Slip had no current listed prices for this item.",
    ]);
  });

  it("a failed payment says nothing was charged", () => {
    const attempt = testAttempt({ decision: testDecision({ ruleCode: "R7_WITHIN_LIMITS" }) });
    const view = renderReceipt({ attempt, payment: payment(attempt, "FAILED"), hold: null });
    expect(view.lines).toContain(
      "PayPal declined the payment (INSTRUMENT_DECLINED). Nothing was charged.",
    );
    expect(view.charged).toBe(false);
  });

  it("never uses trading jargon, whatever the rule or payment state", () => {
    const banned = /basis points|\bbps\b|slippage|\bTCA\b|best execution|landed cost/i;
    const statuses: PaymentStatus[] = [
      "INITIATED",
      "UNKNOWN",
      "PENDING",
      "AUTHORIZED",
      "CAPTURING",
      "VOIDING",
      "CAPTURED",
      "VOIDED",
      "FAILED",
    ];
    for (const ruleCode of RULE_CODES) {
      const attempt = testAttempt({
        decision: testDecision({
          ruleCode,
          chosen: storeA(110, 0.08),
          best: storeB(100, 0.02),
          conflict: true,
        }),
      });
      for (const status of statuses) {
        for (const h of [null, hold(attempt), hold(attempt, "DECLINED")]) {
          const view = renderReceipt(
            { attempt, payment: payment(attempt, status), hold: h },
            { policy: DEFAULT_POLICY },
          );
          for (const line of [...view.lines, ...view.reasons]) {
            expect(line).not.toMatch(banned);
          }
        }
      }
    }
  });
});
