import type { ApprovalPreview, HoldDecided, HoldRefusal } from "@slip/app";
import { type Cents, DEFAULT_POLICY } from "@slip/domain";
import { offer, testAttempt, testDecision } from "@slip/domain/testing";
import { renderReceipt } from "@slip/receipt";
import { describe, expect, it } from "vitest";
import { decisionResult, previewResult } from "./hold-results";

const attempt = testAttempt({
  decision: testDecision({ ruleCode: "R6_ABOVE_ORDER_CAP", chosen: offer({ price: 239 }) }),
});
const receipt = { attempt, payment: null, hold: null };
const view = renderReceipt(receipt, { policy: DEFAULT_POLICY });

describe("what reaches the browser", () => {
  it("a preview carries the amount and the store, and nothing else", () => {
    const preview = {
      status: "preview",
      receipt,
      view,
      kind: "capture",
      amountCents: 23_900,
      merchant: "store-k.example",
    } as ApprovalPreview;
    expect(previewResult(preview)).toEqual({
      status: "preview",
      kind: "capture",
      amountCents: 23_900,
      store: "store-k.example",
    });
  });

  it("a refusal keeps the reason, the message and the numbers the owner needs", () => {
    const changed: HoldRefusal = {
      status: "refused",
      reason: "PRICE_CHANGED",
      message: "The price changed since you looked.",
      amountCents: 31_000 as Cents,
    };
    expect(previewResult(changed)).toEqual(changed);
    const rejected: HoldRefusal = {
      status: "refused",
      reason: "RECHECK_REJECTED",
      message: "Slip would now reject this purchase.",
      ruleCode: "R4_OVERPAID",
    };
    expect(decisionResult(rejected)).toEqual(rejected);
    // Nothing optional is invented.
    const plain: HoldRefusal = { status: "refused", reason: "BUSY", message: "Try again." };
    expect(Object.keys(decisionResult(plain)).sort()).toEqual(["message", "reason", "status"]);
  });

  it("a decision sends receipt views, never the record behind them", () => {
    const done: HoldDecided = { status: "done", receipt, view, followUp: { receipt, view } };
    const result = decisionResult(done);
    expect(result).toEqual({ status: "done", view, followUp: view });
    // The domain record carries PayPal request ids and operations; it must not cross the wire.
    expect(JSON.stringify(result)).not.toContain("operations");
    expect("receipt" in result).toBe(false);
  });

  it("a hold with no follow-up says so", () => {
    const done: HoldDecided = { status: "done", receipt, view, followUp: null };
    expect(decisionResult(done).status === "done" && decisionResult(done)).toMatchObject({
      followUp: null,
    });
  });
});
