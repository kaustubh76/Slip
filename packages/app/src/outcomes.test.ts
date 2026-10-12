import {
  AUTHORIZATION_STATUSES,
  type AuthorizationResult,
  type CaptureResult,
  classifyPaymentMove,
  missingPaymentFields,
  type OrderResult,
  PAYMENT_INTENTS,
  type PaymentIntent,
  type PaymentStatus,
  type VoidResult,
} from "@slip/domain";
import { describe, expect, it } from "vitest";
import {
  afterAuthorizationCheck,
  afterCapture,
  afterOrder,
  afterVoid,
  type Step,
} from "./outcomes.js";

const ORDER_RESULTS: OrderResult[] = [
  { kind: "captured", orderId: "O", captureId: "C" },
  { kind: "pending", orderId: "O", captureId: "C", authorizationId: null },
  { kind: "pending", orderId: "O", captureId: null, authorizationId: "A" },
  { kind: "pending", orderId: "O", captureId: null, authorizationId: null },
  { kind: "authorized", orderId: "O", authorizationId: "A" },
  { kind: "voided", orderId: "O", authorizationId: "A" },
  { kind: "declined", orderId: "O", reason: "INSTRUMENT_DECLINED" },
  { kind: "declined", orderId: null, reason: "INSTRUMENT_DECLINED" },
  { kind: "payer-action-required", orderId: null, approveUrl: "https://x" },
  { kind: "duplicate-invoice", reason: "DUPLICATE_INVOICE_ID" },
  { kind: "unknown", reason: "timeout" },
];

/** A move must be legal from `from`, and carry every PayPal id its target status requires. */
function expectLegal(intent: PaymentIntent, from: PaymentStatus, step: Step) {
  if (step.kind !== "move") {
    return;
  }
  const kind = classifyPaymentMove(intent, from, step.to);
  expect(kind, `${intent} ${from} → ${step.to}`).not.toBe("illegal");
  const fields = {
    paypalOrderId:
      step.patch.paypalOrderId ?? (from === "INITIATED" || from === "UNKNOWN" ? null : "O"),
    authorizationId:
      step.patch.authorizationId ?? (from === "CAPTURING" || from === "VOIDING" ? "A" : null),
    captureId: step.patch.captureId ?? null,
    failureReason: step.patch.failureReason ?? null,
  };
  if (kind === "applied") {
    expect(missingPaymentFields(step.to, fields), `${step.to} fields`).toEqual([]);
  }
}

describe("afterOrder", () => {
  it.each(PAYMENT_INTENTS)(
    "every PayPal answer for a %s order is a legal move or a contradiction",
    (intent) => {
      for (const result of ORDER_RESULTS) {
        const step = afterOrder(intent, result);
        expect(["move", "contradiction"]).toContain(step.kind);
        expectLegal(intent, "INITIATED", step);
        expectLegal(intent, "UNKNOWN", step);
      }
    },
  );

  it.each<[PaymentIntent, OrderResult, string]>([
    ["CAPTURE", { kind: "captured", orderId: "O", captureId: "C" }, "CAPTURED"],
    ["AUTHORIZE", { kind: "authorized", orderId: "O", authorizationId: "A" }, "AUTHORIZED"],
    ["CAPTURE", { kind: "declined", orderId: null, reason: "X" }, "FAILED"],
    ["CAPTURE", { kind: "payer-action-required", orderId: null, approveUrl: null }, "FAILED"],
    ["CAPTURE", { kind: "unknown", reason: "timeout" }, "UNKNOWN"],
    ["CAPTURE", { kind: "duplicate-invoice", reason: "dup" }, "UNKNOWN"],
  ])("%s order answered %j → %s", (intent, result, to) => {
    const step = afterOrder(intent, result);
    expect(step.kind === "move" && step.to).toBe(to);
  });

  it("a duplicate invoice is never a failure: an order for this attempt already exists", () => {
    const step = afterOrder("CAPTURE", { kind: "duplicate-invoice", reason: "dup" });
    expect(step).toMatchObject({ kind: "move", to: "UNKNOWN" });
  });

  it("re-approval is recorded as the failure reason", () => {
    expect(
      afterOrder("CAPTURE", { kind: "payer-action-required", orderId: null, approveUrl: null }),
    ).toMatchObject({
      patch: { failureReason: "PAYER_ACTION_REQUIRED" },
    });
  });

  it("an answer that does not fit the intent is a contradiction", () => {
    expect(afterOrder("AUTHORIZE", { kind: "captured", orderId: "O", captureId: "C" }).kind).toBe(
      "contradiction",
    );
    expect(
      afterOrder("CAPTURE", { kind: "authorized", orderId: "O", authorizationId: "A" }).kind,
    ).toBe("contradiction");
  });
});

describe("afterCapture", () => {
  it.each<[CaptureResult, string]>([
    [{ kind: "captured", captureId: "C" }, "move:CAPTURED"],
    [{ kind: "pending", captureId: "C" }, "move:CAPTURING"],
    [{ kind: "declined", reason: "X" }, "check-authorization"],
    [{ kind: "unknown", reason: "timeout" }, "stay"],
  ])("%j → %s", (result, expected) => {
    const step = afterCapture(result);
    expect(step.kind === "move" ? `move:${step.to}` : step.kind).toBe(expected);
    expectLegal("AUTHORIZE", "CAPTURING", step);
  });
});

describe("afterAuthorizationCheck", () => {
  it("every authorization status is a legal step from CAPTURING and from VOIDING", () => {
    for (const status of AUTHORIZATION_STATUSES) {
      for (const captureId of [null, "C"]) {
        const result: AuthorizationResult = { kind: "found", status, captureId };
        expectLegal("AUTHORIZE", "CAPTURING", afterAuthorizationCheck("CAPTURING", result));
        expectLegal("AUTHORIZE", "VOIDING", afterAuthorizationCheck("VOIDING", result));
      }
    }
  });

  it("a declined capture with the authorization still alive releases it", () => {
    expect(
      afterAuthorizationCheck("CAPTURING", { kind: "found", status: "CREATED", captureId: null })
        .kind,
    ).toBe("void");
  });

  it("a void that finds the money captured is a contradiction", () => {
    expect(
      afterAuthorizationCheck("VOIDING", { kind: "found", status: "CAPTURED", captureId: "C" })
        .kind,
    ).toBe("contradiction");
  });
});

describe("afterVoid", () => {
  it.each<[VoidResult, string]>([
    [{ kind: "voided" }, "move:VOIDED"],
    [{ kind: "not-voidable", status: "EXPIRED", captureId: null }, "move:VOIDED"],
    [{ kind: "not-voidable", status: "DENIED", captureId: null }, "move:VOIDED"],
    [{ kind: "not-voidable", status: "CAPTURED", captureId: "C" }, "contradiction"],
    [{ kind: "unknown", reason: "timeout" }, "stay"],
  ])("%j → %s", (result, expected) => {
    const step = afterVoid(result);
    expect(step.kind === "move" ? `move:${step.to}` : step.kind).toBe(expected);
    expectLegal("AUTHORIZE", "VOIDING", step);
  });
});
