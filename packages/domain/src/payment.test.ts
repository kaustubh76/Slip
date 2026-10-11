import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ConflictError, IllegalTransitionError } from "./errors.js";
import {
  applyPaymentPatch,
  canTransition,
  classifyPaymentMove,
  isTerminal,
  missingPaymentFields,
  PAYMENT_INTENTS,
  PAYMENT_STATUSES,
  PAYMENT_TRANSITIONS,
  type PaymentIntent,
  type PaymentStatus,
  statusesFor,
  TERMINAL_PAYMENT_STATUSES,
  transition,
} from "./payment.js";
import { isAcyclic } from "./state-machine.js";

/** The full list of legal moves, written out by hand so the table cannot drift unnoticed. */
const ALLOWED: Record<PaymentIntent, string[]> = {
  CAPTURE: [
    "NONE→INITIATED",
    "INITIATED→UNKNOWN",
    "INITIATED→PENDING",
    "INITIATED→CAPTURED",
    "INITIATED→FAILED",
    "UNKNOWN→PENDING",
    "UNKNOWN→CAPTURED",
    "UNKNOWN→FAILED",
    "PENDING→CAPTURED",
    "PENDING→FAILED",
  ],
  AUTHORIZE: [
    "NONE→INITIATED",
    "INITIATED→UNKNOWN",
    "INITIATED→PENDING",
    "INITIATED→AUTHORIZED",
    "INITIATED→FAILED",
    "INITIATED→VOIDED",
    "UNKNOWN→PENDING",
    "UNKNOWN→AUTHORIZED",
    "UNKNOWN→FAILED",
    "UNKNOWN→VOIDED",
    "PENDING→AUTHORIZED",
    "PENDING→FAILED",
    "PENDING→VOIDED",
    "AUTHORIZED→CAPTURING",
    "AUTHORIZED→VOIDING",
    "AUTHORIZED→VOIDED",
    "CAPTURING→CAPTURED",
    "CAPTURING→FAILED",
    "CAPTURING→VOIDING",
    "CAPTURING→VOIDED",
    "VOIDING→VOIDED",
  ],
};

function edges(intent: PaymentIntent): string[] {
  return PAYMENT_STATUSES.flatMap((from) =>
    PAYMENT_TRANSITIONS[intent][from].map((to) => `${from}→${to}`),
  ).sort();
}

describe.each(PAYMENT_INTENTS)("%s payment state machine", (intent) => {
  it("allows exactly the listed moves", () => {
    expect(edges(intent)).toEqual([...ALLOWED[intent]].sort());
  });

  it("is acyclic, so a late report can always be recognised as stale", () => {
    expect(isAcyclic(PAYMENT_TRANSITIONS[intent])).toBe(true);
  });

  it("every pair is either allowed or throws", () => {
    for (const from of PAYMENT_STATUSES) {
      for (const to of PAYMENT_STATUSES) {
        const allowed = ALLOWED[intent].includes(`${from}→${to}`);
        expect(canTransition(intent, from, to)).toBe(allowed);
        if (allowed) {
          expect(transition(intent, from, to)).toBe(to);
        } else {
          expect(() => transition(intent, from, to)).toThrow(IllegalTransitionError);
        }
      }
    }
  });

  it("terminal statuses have no exits", () => {
    for (const status of TERMINAL_PAYMENT_STATUSES) {
      expect(PAYMENT_TRANSITIONS[intent][status]).toEqual([]);
      expect(isTerminal(status)).toBe(true);
    }
  });
});

describe("intents keep to their own statuses", () => {
  it("a one-step CAPTURE payment never authorizes, captures a hold, or voids", () => {
    expect(statusesFor("CAPTURE").sort()).toEqual(
      ["NONE", "INITIATED", "UNKNOWN", "PENDING", "CAPTURED", "FAILED"].sort(),
    );
  });

  it("an AUTHORIZE payment only captures through CAPTURING", () => {
    expect(canTransition("AUTHORIZE", "INITIATED", "CAPTURED")).toBe(false);
    expect(canTransition("AUTHORIZE", "AUTHORIZED", "CAPTURED")).toBe(false);
    expect(statusesFor("AUTHORIZE")).toEqual([...PAYMENT_STATUSES]);
  });
});

describe("classifyPaymentMove", () => {
  it.each<[PaymentIntent, PaymentStatus, PaymentStatus, string]>([
    ["CAPTURE", "INITIATED", "CAPTURED", "applied"],
    ["CAPTURE", "UNKNOWN", "UNKNOWN", "unchanged"],
    ["CAPTURE", "CAPTURED", "PENDING", "stale"], // late webhook after the capture landed
    ["CAPTURE", "CAPTURED", "INITIATED", "stale"],
    ["CAPTURE", "PENDING", "UNKNOWN", "stale"],
    ["CAPTURE", "FAILED", "CAPTURED", "illegal"], // genuine disagreement
    ["CAPTURE", "CAPTURED", "FAILED", "illegal"],
    ["AUTHORIZE", "CAPTURING", "AUTHORIZED", "stale"],
    ["AUTHORIZE", "VOIDED", "CAPTURED", "illegal"],
    ["AUTHORIZE", "CAPTURED", "VOIDED", "illegal"],
    // A declined capture moves CAPTURING → VOIDING; a late CAPTURING report is behind us.
    ["AUTHORIZE", "VOIDING", "CAPTURING", "stale"],
    ["AUTHORIZE", "FAILED", "VOIDING", "illegal"],
  ])("%s %s then %s → %s", (intent, from, to, expected) => {
    expect(classifyPaymentMove(intent, from, to)).toBe(expected);
  });
});

/**
 * PayPal reports one payment through the API response, webhooks and the resolver's lookups, in
 * any order and with repeats. Along any path PayPal could actually take, applying those reports
 * in any order must end in the same place and never throw.
 */
describe("out-of-order reports converge", () => {
  const OBSERVABLE: Record<PaymentIntent, PaymentStatus[]> = {
    CAPTURE: ["UNKNOWN", "PENDING", "CAPTURED", "FAILED"],
    // CAPTURING and VOIDING are Slip's own write-ahead states, entered in order by Slip.
    AUTHORIZE: ["UNKNOWN", "PENDING", "AUTHORIZED", "FAILED", "VOIDED"],
  };

  function paths(intent: PaymentIntent, from: PaymentStatus): PaymentStatus[][] {
    const next = PAYMENT_TRANSITIONS[intent][from].filter((s) => OBSERVABLE[intent].includes(s));
    if (next.length === 0) {
      return [[]];
    }
    return [[], ...next.flatMap((s) => paths(intent, s).map((rest) => [s, ...rest]))];
  }

  function apply(intent: PaymentIntent, start: PaymentStatus, reports: PaymentStatus[]) {
    let status = start;
    for (const report of reports) {
      const kind = classifyPaymentMove(intent, status, report);
      if (kind === "illegal") {
        throw new Error(`${status} then ${report} was classified illegal`);
      }
      if (kind === "applied") {
        status = report;
      }
    }
    return status;
  }

  it.each(PAYMENT_INTENTS)("%s", (intent) => {
    const all = paths(intent, "INITIATED").filter((p) => p.length > 0);
    expect(all.length).toBeGreaterThan(3);
    for (const path of all) {
      const last = path[path.length - 1] as PaymentStatus;
      fc.assert(
        fc.property(
          fc.array(fc.constantFrom(...path), { maxLength: path.length * 2 }).chain((extra) =>
            fc.shuffledSubarray([...path, ...extra], {
              minLength: path.length + extra.length,
              maxLength: path.length + extra.length,
            }),
          ),
          (reports) => {
            expect(apply(intent, "INITIATED", reports)).toBe(last);
          },
        ),
        { numRuns: 50 },
      );
    }
  });
});

describe("missingPaymentFields", () => {
  const empty = {
    paypalOrderId: null,
    authorizationId: null,
    captureId: null,
    failureReason: null,
  };

  it.each<[PaymentStatus, string[]]>([
    ["INITIATED", []],
    ["UNKNOWN", []],
    ["PENDING", ["paypalOrderId"]],
    ["AUTHORIZED", ["paypalOrderId", "authorizationId"]],
    ["CAPTURING", ["paypalOrderId", "authorizationId"]],
    ["VOIDING", ["paypalOrderId", "authorizationId"]],
    ["VOIDED", ["paypalOrderId", "authorizationId"]],
    ["CAPTURED", ["paypalOrderId", "captureId"]],
    ["FAILED", ["failureReason"]],
  ])("%s needs %j", (status, expected) => {
    expect(missingPaymentFields(status, empty)).toEqual(expected);
  });
});

describe("applyPaymentPatch (set-once PayPal ids)", () => {
  const base = { paypalOrderId: null, authorizationId: null, captureId: null, failureReason: null };

  it("fills empty fields and accepts a repeat of the same value", () => {
    const once = applyPaymentPatch(base, { paypalOrderId: "ORDER-1" });
    expect(once.paypalOrderId).toBe("ORDER-1");
    expect(applyPaymentPatch(once, { paypalOrderId: "ORDER-1", captureId: "CAP-1" })).toEqual({
      ...base,
      paypalOrderId: "ORDER-1",
      captureId: "CAP-1",
    });
  });

  it("refuses to change a set field", () => {
    const once = applyPaymentPatch(base, { captureId: "CAP-1" });
    expect(() => applyPaymentPatch(once, { captureId: "CAP-2" })).toThrow(ConflictError);
  });
});
