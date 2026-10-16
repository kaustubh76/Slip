import type { CheckoutResult } from "@slip/app";
import { DEFAULT_POLICY } from "@slip/domain";
import { offer, testAttempt, testDecision } from "@slip/domain/testing";
import { renderReceipt } from "@slip/receipt";
import { describe, expect, it } from "vitest";
import { bearerKey, checkoutResponse } from "./agent-api";

const paid = () => {
  const chosen = offer({ price: 10 });
  const attempt = testAttempt({
    decision: testDecision({ ruleCode: "R7_WITHIN_LIMITS", chosen, best: chosen }),
  });
  return { attempt, payment: null, hold: null };
};

describe("bearerKey", () => {
  it("takes the key out of the header, and nothing else", () => {
    expect(bearerKey("Bearer slip_live_abc")).toBe("slip_live_abc");
    expect(bearerKey("bearer   slip_live_abc")).toBe("slip_live_abc");
    for (const header of [null, "", "slip_live_abc", "Basic abc", "Bearer", "Bearer   "]) {
      expect(bearerKey(header), String(header)).toBeNull();
    }
  });
});

describe("checkoutResponse", () => {
  it("a decision is 200 with the outcome, whether money moved, and the owner's receipt", () => {
    const receipt = paid();
    const view = renderReceipt(receipt, { policy: DEFAULT_POLICY });
    const result: CheckoutResult = { status: "decided", receipt, view };
    expect(checkoutResponse(result)).toEqual({
      status: 200,
      body: {
        status: "decided",
        outcome: "PAID",
        rule: "R7_WITHIN_LIMITS",
        charged: false,
        receiptId: view.receiptId,
        receipt: view,
      },
    });
  });

  it("a replay says so, so an agent does not count it as a second purchase", () => {
    const receipt = paid();
    const view = renderReceipt(receipt, { policy: DEFAULT_POLICY });
    const answer = checkoutResponse({
      status: "replayed",
      reason: "ALREADY_PAID",
      receipt,
      view,
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ status: "replayed", reason: "ALREADY_PAID" });
  });

  it("each refusal gets the status code that says what to do about it", () => {
    const cases: [string, number][] = [
      ["UNAUTHENTICATED", 401],
      ["MANDATE_NOT_ACTIVE", 403],
      ["INVALID_REQUEST", 400],
      ["BUSY", 409],
      ["RETRY_LIMIT", 429],
      // Anything Slip has not mapped is the agent's fault, not the server's.
      ["SOMETHING_NEW", 400],
    ];
    for (const [reason, status] of cases) {
      const answer = checkoutResponse({
        status: "refused",
        reason: reason as never,
        message: "…",
        receiptId: null,
      });
      expect(answer.status, reason).toBe(status);
      expect(answer.body).toMatchObject({ status: "refused", reason });
      // A refusal carries no receipt: nothing was recorded.
      expect(answer.body.receipt).toBeUndefined();
    }
  });
});
