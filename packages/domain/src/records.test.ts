import { describe, expect, it } from "vitest";
import {
  ConflictError,
  HoldAlreadyDecidedError,
  HoldExpiredError,
  HoldNotReadyError,
  IllegalTransitionError,
  InvariantError,
} from "./errors.js";
import type { Hold } from "./hold.js";
import { attemptId, type RequestId, requestId } from "./ids.js";
import type { Payment, PaymentStatus } from "./payment.js";
import type { RecordAttemptInput } from "./ports/store.js";
import {
  assertRecordInvariants,
  initialHold,
  initialPayment,
  planHoldDecision,
  planPaymentTransition,
} from "./records.js";
import {
  minutesFromNow,
  NOW,
  offer,
  testAttempt,
  testDecision,
  testUuid,
} from "./testing/index.js";

const REQ: RequestId = requestId(testUuid(0x1));
const REQ2: RequestId = requestId(testUuid(0x2));

function input(
  overrides: Partial<RecordAttemptInput> & Pick<RecordAttemptInput, "attempt">,
): RecordAttemptInput {
  return { payment: null, hold: null, leaseHolder: "h", ...overrides };
}

const paid = () => testAttempt({ decision: testDecision({ ruleCode: "R7_WITHIN_LIMITS" }) });
const rejected = () => testAttempt({ decision: testDecision({ ruleCode: "R4_OVERPAID" }) });
const held = () => testAttempt({ decision: testDecision({ ruleCode: "R6_ABOVE_ORDER_CAP" }) });

describe("assertRecordInvariants", () => {
  it.each([
    [
      "PAID with a CAPTURE payment",
      () => input({ attempt: paid(), payment: { intent: "CAPTURE", requestId: REQ } }),
    ],
    ["REJECTED with nothing", () => input({ attempt: rejected() })],
    [
      "HELD with a hold only (no PayPal order)",
      () => input({ attempt: held(), hold: { expiresAt: minutesFromNow(60) } }),
    ],
    [
      "HELD with a hold and an AUTHORIZE payment",
      () =>
        input({
          attempt: held(),
          hold: { expiresAt: minutesFromNow(60) },
          payment: { intent: "AUTHORIZE", requestId: REQ },
        }),
    ],
  ])("accepts %s", (_label, make) => {
    expect(() => assertRecordInvariants(make())).not.toThrow();
  });

  it.each([
    [
      "REJECTED with a payment",
      () => input({ attempt: rejected(), payment: { intent: "CAPTURE", requestId: REQ } }),
    ],
    [
      "REJECTED with a hold",
      () => input({ attempt: rejected(), hold: { expiresAt: minutesFromNow(60) } }),
    ],
    ["PAID without a payment", () => input({ attempt: paid() })],
    [
      "PAID with an AUTHORIZE payment",
      () => input({ attempt: paid(), payment: { intent: "AUTHORIZE", requestId: REQ } }),
    ],
    [
      "PAID with a hold",
      () =>
        input({
          attempt: paid(),
          payment: { intent: "CAPTURE", requestId: REQ },
          hold: { expiresAt: minutesFromNow(60) },
        }),
    ],
    ["HELD without a hold", () => input({ attempt: held() })],
    [
      "HELD with a CAPTURE payment",
      () =>
        input({
          attempt: held(),
          hold: { expiresAt: minutesFromNow(60) },
          payment: { intent: "CAPTURE", requestId: REQ },
        }),
    ],
    ["a hold that expires at creation", () => input({ attempt: held(), hold: { expiresAt: NOW } })],
    [
      "a payment without a chosen price",
      () =>
        input({
          attempt: testAttempt({
            decision: testDecision({
              ruleCode: "R7_WITHIN_LIMITS",
              chosen: offer({ price: null }),
            }),
          }),
          payment: { intent: "CAPTURE", requestId: REQ },
        }),
    ],
    [
      "a payment in another currency",
      () =>
        input({
          attempt: testAttempt({
            decision: testDecision({
              ruleCode: "R7_WITHIN_LIMITS",
              chosen: offer({ price: 10, currency: "EUR" }),
            }),
          }),
          payment: { intent: "CAPTURE", requestId: REQ },
        }),
    ],
    [
      "an outcome that does not match its rule",
      () => {
        const attempt = paid();
        return input({
          attempt: { ...attempt, decision: { ...attempt.decision, outcome: "HELD" } },
          payment: { intent: "CAPTURE", requestId: REQ },
        });
      },
    ],
    [
      "ruleCodes that do not start with the deciding rule",
      () => {
        const d = testDecision({ ruleCode: "R4_OVERPAID" });
        return input({
          attempt: testAttempt({
            decision: {
              ...d,
              checkResult: { ...d.checkResult, ruleCodes: ["R6_ABOVE_ORDER_CAP", "R4_OVERPAID"] },
            },
          }),
        });
      },
    ],
    [
      "an AGENT attempt decided by OWNER_APPROVED",
      () =>
        input({
          attempt: testAttempt({ decision: testDecision({ ruleCode: "OWNER_APPROVED" }) }),
          payment: { intent: "CAPTURE", requestId: REQ },
        }),
    ],
    [
      "an AGENT attempt with a parent",
      () => input({ attempt: { ...rejected(), parentAttemptId: attemptId(testUuid()) } }),
    ],
    [
      "an OWNER_APPROVAL attempt without a parent",
      () =>
        input({
          attempt: testAttempt({
            origin: "OWNER_APPROVAL",
            decision: testDecision({ ruleCode: "OWNER_APPROVED" }),
          }),
          payment: { intent: "CAPTURE", requestId: REQ },
        }),
    ],
    [
      "an OWNER_APPROVAL attempt that is HELD again",
      () =>
        input({
          attempt: testAttempt({
            origin: "OWNER_APPROVAL",
            parentAttemptId: attemptId(testUuid()),
            decision: testDecision({ ruleCode: "R6_ABOVE_ORDER_CAP" }),
          }),
          hold: { expiresAt: minutesFromNow(60) },
        }),
    ],
    [
      "a PAID OWNER_APPROVAL attempt not decided by OWNER_APPROVED",
      () =>
        input({
          attempt: testAttempt({
            origin: "OWNER_APPROVAL",
            parentAttemptId: attemptId(testUuid()),
            decision: testDecision({ ruleCode: "R7_WITHIN_LIMITS" }),
          }),
          payment: { intent: "CAPTURE", requestId: REQ },
        }),
    ],
  ])("refuses %s", (_label, make) => {
    expect(() => assertRecordInvariants(make())).toThrow(InvariantError);
  });

  it("accepts an OWNER_APPROVAL attempt that pays, and one whose re-check rejects", () => {
    const parent = attemptId(testUuid());
    expect(() =>
      assertRecordInvariants(
        input({
          attempt: testAttempt({
            origin: "OWNER_APPROVAL",
            parentAttemptId: parent,
            decision: testDecision({
              ruleCode: "OWNER_APPROVED",
              alsoTripped: ["R6_ABOVE_ORDER_CAP"],
            }),
          }),
          payment: { intent: "CAPTURE", requestId: REQ },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertRecordInvariants(
        input({
          attempt: testAttempt({
            origin: "OWNER_APPROVAL",
            parentAttemptId: parent,
            decision: testDecision({ ruleCode: "R4_OVERPAID" }),
          }),
        }),
      ),
    ).not.toThrow();
  });
});

describe("initialPayment / initialHold", () => {
  it("prices the payment from the snapshot and writes the ORDER request id first", () => {
    const attempt = testAttempt({
      decision: testDecision({ ruleCode: "R7_WITHIN_LIMITS", chosen: offer({ price: 47.99 }) }),
    });
    const payment = initialPayment(
      input({ attempt, payment: { intent: "CAPTURE", requestId: REQ } }),
    );
    expect(payment).toMatchObject({
      attemptId: attempt.id,
      status: "INITIATED",
      intent: "CAPTURE",
      amountCents: 4799,
      currency: "USD",
      operations: [{ kind: "ORDER", requestId: REQ, createdAt: attempt.createdAt }],
    });
  });

  it("opens a PENDING hold with the requested expiry", () => {
    const attempt = held();
    expect(initialHold(input({ attempt, hold: { expiresAt: minutesFromNow(30) } }))).toEqual({
      attemptId: attempt.id,
      status: "PENDING",
      createdAt: attempt.createdAt,
      expiresAt: minutesFromNow(30),
      decidedAt: null,
      decidedBy: null,
    });
  });
});

function paymentIn(status: PaymentStatus, overrides: Partial<Payment> = {}): Payment {
  const attempt = held();
  const base = initialPayment(
    input({
      attempt,
      hold: { expiresAt: minutesFromNow(60) },
      payment: { intent: "AUTHORIZE", requestId: REQ },
    }),
  );
  if (base === null) {
    throw new Error("unreachable");
  }
  return {
    ...base,
    status,
    paypalOrderId: "ORDER-1",
    authorizationId: "AUTH-1",
    ...overrides,
  };
}

describe("planPaymentTransition", () => {
  it("applies a legal move with an event", () => {
    const plan = planPaymentTransition(
      paymentIn("INITIATED", { authorizationId: null, paypalOrderId: null }),
      "AUTHORIZED",
      {
        patch: { paypalOrderId: "ORDER-1", authorizationId: "AUTH-1" },
        detail: { source: "api" },
        now: minutesFromNow(1),
      },
    );
    expect(plan.result).toBe("applied");
    expect(plan.payment.status).toBe("AUTHORIZED");
    expect(plan.payment.updatedAt).toEqual(minutesFromNow(1));
    expect(plan.event).toMatchObject({
      fromStatus: "INITIATED",
      toStatus: "AUTHORIZED",
      detail: { source: "api" },
    });
  });

  it("treats a late report as stale: no change, no event", () => {
    const current = paymentIn("CAPTURING");
    const plan = planPaymentTransition(current, "AUTHORIZED", { now: minutesFromNow(1) });
    expect(plan).toEqual({
      result: "stale",
      payment: current,
      changed: false,
      event: null,
      operation: null,
    });
  });

  it("a repeat is unchanged but may fill an empty id", () => {
    const current = paymentIn("PENDING", { authorizationId: null });
    const plan = planPaymentTransition(current, "PENDING", {
      patch: { authorizationId: "AUTH-9" },
      now: minutesFromNow(1),
    });
    expect(plan.result).toBe("unchanged");
    expect(plan.changed).toBe(true);
    expect(plan.event).toBeNull();
    expect(plan.payment.authorizationId).toBe("AUTH-9");
  });

  it("a genuine disagreement throws", () => {
    expect(() => planPaymentTransition(paymentIn("VOIDED"), "CAPTURED", { now: NOW })).toThrow(
      IllegalTransitionError,
    );
  });

  it("refuses a status whose required PayPal ids are missing", () => {
    expect(() =>
      planPaymentTransition(
        paymentIn("INITIATED", { paypalOrderId: null, authorizationId: null }),
        "AUTHORIZED",
        { now: NOW },
      ),
    ).toThrow(InvariantError);
  });

  it("entering CAPTURING writes the capture request id; without one it refuses", () => {
    const plan = planPaymentTransition(paymentIn("AUTHORIZED"), "CAPTURING", {
      operationRequestId: REQ2,
      now: minutesFromNow(2),
    });
    expect(plan.operation).toEqual({
      kind: "CAPTURE",
      requestId: REQ2,
      createdAt: minutesFromNow(2),
    });
    expect(plan.payment.operations.map((op) => op.kind)).toEqual(["ORDER", "CAPTURE"]);
    expect(() => planPaymentTransition(paymentIn("AUTHORIZED"), "CAPTURING", { now: NOW })).toThrow(
      InvariantError,
    );
  });

  it("refuses a second operation of the same kind and a stray request id", () => {
    const capturing = planPaymentTransition(paymentIn("AUTHORIZED"), "CAPTURING", {
      operationRequestId: REQ2,
      now: NOW,
    }).payment;
    const withVoid = planPaymentTransition(capturing, "VOIDING", {
      operationRequestId: requestId(testUuid(3)),
      now: NOW,
    }).payment;
    expect(withVoid.operations.map((op) => op.kind)).toEqual(["ORDER", "CAPTURE", "VOID"]);
    expect(() =>
      planPaymentTransition(
        { ...paymentIn("AUTHORIZED"), operations: withVoid.operations },
        "VOIDING",
        {
          operationRequestId: requestId(testUuid(4)),
          now: NOW,
        },
      ),
    ).toThrow(ConflictError);
    expect(() =>
      planPaymentTransition(paymentIn("CAPTURING"), "CAPTURED", {
        patch: { captureId: "C" },
        operationRequestId: REQ2,
        now: NOW,
      }),
    ).toThrow(InvariantError);
  });

  it("refuses to change a PayPal id that is already set", () => {
    expect(() =>
      planPaymentTransition(paymentIn("AUTHORIZED"), "VOIDED", {
        patch: { authorizationId: "AUTH-OTHER" },
        now: NOW,
      }),
    ).toThrow(ConflictError);
  });
});

function pendingHold(expiresInMinutes = 60): Hold {
  return {
    attemptId: attemptId(testUuid()),
    status: "PENDING",
    createdAt: NOW,
    expiresAt: minutesFromNow(expiresInMinutes),
    decidedAt: null,
    decidedBy: null,
  };
}

describe("planHoldDecision", () => {
  const at = minutesFromNow(5);

  it("approve with a confirmed authorization starts the capture in the same plan", () => {
    const plan = planHoldDecision(pendingHold(), paymentIn("AUTHORIZED"), {
      kind: "approve",
      by: "owner",
      now: at,
      requestId: REQ2,
    });
    expect(plan.result).toBe("applied");
    expect(plan.hold).toMatchObject({ status: "APPROVED", decidedAt: at, decidedBy: "owner" });
    expect(plan.paymentPlan?.payment.status).toBe("CAPTURING");
    expect(plan.paymentPlan?.operation?.requestId).toBe(REQ2);
  });

  it("approve without a payment just approves; the caller re-checks and pays", () => {
    const plan = planHoldDecision(pendingHold(), null, {
      kind: "approve",
      by: "owner",
      now: at,
      requestId: REQ2,
    });
    expect(plan.hold.status).toBe("APPROVED");
    expect(plan.paymentPlan).toBeNull();
  });

  it.each<PaymentStatus>(["INITIATED", "UNKNOWN", "PENDING"])(
    "approve while the payment is %s is not ready",
    (status) => {
      expect(() =>
        planHoldDecision(pendingHold(), paymentIn(status), {
          kind: "approve",
          by: "owner",
          now: at,
          requestId: REQ2,
        }),
      ).toThrow(HoldNotReadyError);
    },
  );

  it("approve exactly at the expiry is too late", () => {
    const hold = pendingHold(5);
    expect(() =>
      planHoldDecision(hold, null, {
        kind: "approve",
        by: "owner",
        now: hold.expiresAt,
        requestId: REQ2,
      }),
    ).toThrow(HoldExpiredError);
  });

  it("decline voids a confirmed authorization; an unconfirmed one is left for the resolver", () => {
    const voided = planHoldDecision(pendingHold(), paymentIn("AUTHORIZED"), {
      kind: "decline",
      by: "owner",
      now: at,
      requestId: REQ2,
    });
    expect(voided.paymentPlan?.payment.status).toBe("VOIDING");
    const later = planHoldDecision(pendingHold(), paymentIn("UNKNOWN"), {
      kind: "decline",
      by: "owner",
      now: at,
      requestId: REQ2,
    });
    expect(later.hold.status).toBe("DECLINED");
    expect(later.paymentPlan).toBeNull();
  });

  it("expire only once due, decided by the system", () => {
    const hold = pendingHold(5);
    expect(() =>
      planHoldDecision(hold, null, { kind: "expire", now: minutesFromNow(4), requestId: REQ2 }),
    ).toThrow(ConflictError);
    const plan = planHoldDecision(hold, paymentIn("AUTHORIZED"), {
      kind: "expire",
      now: hold.expiresAt,
      requestId: REQ2,
    });
    expect(plan.hold).toMatchObject({ status: "EXPIRED", decidedBy: "system" });
    expect(plan.paymentPlan?.payment.status).toBe("VOIDING");
  });

  it("the same decision twice is unchanged; a different one is refused", () => {
    const declined = planHoldDecision(pendingHold(), null, {
      kind: "decline",
      by: "owner",
      now: at,
      requestId: REQ2,
    }).hold;
    expect(
      planHoldDecision(declined, null, { kind: "decline", by: "owner", now: at, requestId: REQ2 })
        .result,
    ).toBe("unchanged");
    expect(() =>
      planHoldDecision(declined, null, { kind: "approve", by: "owner", now: at, requestId: REQ2 }),
    ).toThrow(HoldAlreadyDecidedError);
  });
});
