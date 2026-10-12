import {
  AUTHORIZATION_STATUSES,
  type AuthorizationResult,
  type CaptureResult,
  classifyPaymentMove,
  missingPaymentFields,
  type OrderResult,
  PAYMENT_INTENTS,
  PAYMENT_STATUSES,
  type Payment,
  type PaymentIntent,
  type PaymentStatus,
  type VoidResult,
} from "@slip/domain";
import { describe, expect, it } from "vitest";
import {
  afterAuthorizationCheck,
  afterCapture,
  afterLookup,
  afterOrder,
  afterOrderRead,
  afterVoid,
  afterWebhook,
  type PaymentWebhookEvent,
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

describe("afterOrderRead and afterLookup", () => {
  it.each(PAYMENT_INTENTS)(
    "every answer to reading a %s order is legal, a wait, or a contradiction",
    (intent) => {
      for (const result of ORDER_RESULTS) {
        const step = afterOrderRead(intent, result);
        expect(["move", "stay", "contradiction"]).toContain(step.kind);
        expectLegal(intent, "UNKNOWN", step);
      }
    },
  );

  it("an order that cannot be read stays as it is, never UNKNOWN again", () => {
    expect(afterOrderRead("CAPTURE", { kind: "unknown", reason: "RESOURCE_NOT_FOUND" })).toEqual({
      kind: "stay",
      why: "RESOURCE_NOT_FOUND",
    });
  });

  it("a found order maps like the order call itself", () => {
    const order: OrderResult = { kind: "captured", orderId: "O", captureId: "C" };
    expect(afterLookup("CAPTURE", { kind: "found", order }, false)).toEqual(
      afterOrder("CAPTURE", order),
    );
  });

  it("'not found' fails the payment only once it may give up", () => {
    expect(afterLookup("CAPTURE", { kind: "not-found" }, false).kind).toBe("stay");
    const failed = afterLookup("CAPTURE", { kind: "not-found" }, true);
    expect(failed).toMatchObject({
      kind: "move",
      to: "FAILED",
      patch: { failureReason: "ORDER_NOT_FOUND" },
    });
    expectLegal("CAPTURE", "UNKNOWN", failed);
    expectLegal("AUTHORIZE", "INITIATED", afterLookup("AUTHORIZE", { kind: "not-found" }, true));
  });

  it("an unanswered search never fails it, however late", () => {
    expect(afterLookup("CAPTURE", { kind: "unknown", reason: "503" }, true).kind).toBe("stay");
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

describe("afterWebhook", () => {
  const EVENTS: PaymentWebhookEvent[] = [
    { kind: "capture-completed", attemptId: "a", orderId: "O", captureId: "C" },
    { kind: "capture-completed", attemptId: "a", orderId: null, captureId: "C" },
    { kind: "capture-pending", attemptId: "a", orderId: "O", captureId: "C" },
    { kind: "capture-declined", attemptId: "a", captureId: null, reason: "DECLINED" },
    { kind: "authorization-created", attemptId: "a", orderId: "O", authorizationId: "A" },
    { kind: "authorization-created", attemptId: "a", orderId: null, authorizationId: "A" },
    { kind: "authorization-voided", attemptId: "a", authorizationId: "A" },
  ];

  /** A payment in `status` with the PayPal ids that status requires already set. */
  function paymentIn(intent: PaymentIntent, status: PaymentStatus): Payment {
    const known = status !== "INITIATED" && status !== "UNKNOWN";
    return {
      intent,
      status,
      paypalOrderId: known ? "O" : null,
      authorizationId: intent === "AUTHORIZE" && known && status !== "PENDING" ? "A" : null,
      captureId: status === "CAPTURED" ? "C" : null,
      failureReason: status === "FAILED" ? "X" : null,
    } as Payment;
  }

  it.each(PAYMENT_INTENTS)(
    "every %s event in every status is a legal move with its ids, a wait, a check or a contradiction",
    (intent) => {
      for (const status of PAYMENT_STATUSES) {
        const payment = paymentIn(intent, status);
        for (const event of EVENTS) {
          const step = afterWebhook(payment, event);
          if (step.kind !== "move") {
            continue;
          }
          const kind = classifyPaymentMove(intent, status, step.to);
          if (kind === "applied") {
            const fields = {
              paypalOrderId: step.patch.paypalOrderId ?? payment.paypalOrderId,
              authorizationId: step.patch.authorizationId ?? payment.authorizationId,
              captureId: step.patch.captureId ?? payment.captureId,
              failureReason: step.patch.failureReason ?? payment.failureReason,
            };
            expect(
              missingPaymentFields(step.to, fields),
              `${intent} ${status} ${event.kind}`,
            ).toEqual([]);
          }
        }
      }
    },
  );

  it("an authorization reported before Slip knows the order waits for the lookup", () => {
    const step = afterWebhook(paymentIn("AUTHORIZE", "UNKNOWN"), EVENTS[5] as PaymentWebhookEvent);
    expect(step.kind).toBe("stay");
    expect(
      afterWebhook(paymentIn("AUTHORIZE", "UNKNOWN"), EVENTS[4] as PaymentWebhookEvent),
    ).toMatchObject({
      kind: "move",
      to: "AUTHORIZED",
      patch: { paypalOrderId: "O", authorizationId: "A" },
    });
  });

  it("a declined capture of a hold asks about the authorization; of a one-step order it fails it", () => {
    const declined = EVENTS[3] as PaymentWebhookEvent;
    expect(afterWebhook(paymentIn("AUTHORIZE", "CAPTURING"), declined).kind).toBe(
      "check-authorization",
    );
    expect(afterWebhook(paymentIn("CAPTURE", "PENDING"), declined)).toMatchObject({
      to: "FAILED",
      patch: { failureReason: "DECLINED" },
    });
    expect(afterWebhook(paymentIn("AUTHORIZE", "VOIDED"), declined).kind).toBe("stay");
  });

  it("a capture Slip never started is a contradiction; one-step payments have no authorization", () => {
    expect(
      afterWebhook(paymentIn("AUTHORIZE", "AUTHORIZED"), EVENTS[2] as PaymentWebhookEvent).kind,
    ).toBe("contradiction");
    expect(
      afterWebhook(paymentIn("CAPTURE", "UNKNOWN"), EVENTS[4] as PaymentWebhookEvent).kind,
    ).toBe("contradiction");
  });
});
