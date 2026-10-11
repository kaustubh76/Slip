import { RULE_OUTCOME } from "./attempt.js";
import {
  ConflictError,
  HoldAlreadyDecidedError,
  HoldExpiredError,
  HoldNotReadyError,
  IllegalTransitionError,
  InvariantError,
} from "./errors.js";
import { HOLD_TRANSITIONS, type Hold, type HoldStatus, SYSTEM_DECIDER } from "./hold.js";
import type { RequestId } from "./ids.js";
import {
  applyPaymentPatch,
  classifyPaymentMove,
  ENTRY_OPERATION,
  missingPaymentFields,
  type Payment,
  type PaymentEvent,
  type PaymentOperation,
  type PaymentStatus,
} from "./payment.js";
import type { LeaseKey, PaymentTransitionInput, RecordAttemptInput } from "./ports/store.js";
import { classifyMove, type TransitionResult } from "./state-machine.js";

/**
 * Pure rules shared by every `Store` implementation, so the Postgres store and the in-memory
 * fake accept and refuse exactly the same writes. The database repeats the critical ones as
 * constraints and triggers (defence in depth); these produce the readable errors.
 */

/** Checks one `AttemptRepo.record` input. Throws `InvariantError` naming the broken rule. */
export function assertRecordInvariants(input: RecordAttemptInput): void {
  const { attempt, payment, hold } = input;
  const { decision } = attempt;
  const { checkResult } = decision;
  const fail = (rule: string): never => {
    throw new InvariantError(`attempt ${attempt.id}: ${rule}`);
  };

  if (decision.ruleCode !== checkResult.ruleCode) {
    fail("decision.ruleCode differs from checkResult.ruleCode");
  }
  if (checkResult.ruleCodes[0] !== decision.ruleCode) {
    fail("ruleCodes must start with the deciding rule");
  }
  if (decision.outcome !== RULE_OUTCOME[decision.ruleCode]) {
    fail(`outcome ${decision.outcome} does not match rule ${decision.ruleCode}`);
  }

  if (attempt.origin === "AGENT") {
    if (attempt.parentAttemptId !== null) {
      fail("an AGENT attempt has no parent");
    }
    if (decision.ruleCode === "OWNER_APPROVED") {
      fail("only an OWNER_APPROVAL attempt can be decided by OWNER_APPROVED");
    }
  } else {
    if (attempt.parentAttemptId === null || attempt.parentAttemptId === attempt.id) {
      fail("an OWNER_APPROVAL attempt needs a parent other than itself");
    }
    if (decision.outcome === "HELD") {
      fail("an OWNER_APPROVAL attempt resolves the hold; it cannot be HELD again");
    }
    if (decision.outcome === "PAID" && decision.ruleCode !== "OWNER_APPROVED") {
      fail("a PAID OWNER_APPROVAL attempt is decided by OWNER_APPROVED");
    }
  }

  switch (decision.outcome) {
    case "REJECTED":
      if (payment !== null || hold !== null) {
        fail("a REJECTED attempt has no payment and no hold");
      }
      break;
    case "PAID":
      if (payment?.intent !== "CAPTURE") {
        fail("a PAID attempt needs a CAPTURE payment");
      }
      if (hold !== null) {
        fail("a PAID attempt has no hold");
      }
      break;
    case "HELD":
      if (hold === null) {
        fail("a HELD attempt needs a hold");
      }
      if (payment !== null && payment.intent !== "AUTHORIZE") {
        fail("a HELD attempt's payment must be AUTHORIZE");
      }
      break;
  }

  if (payment !== null && checkResult.chosen?.priceCents == null) {
    fail("a payment needs the chosen offer's price");
  }
  if (payment !== null && checkResult.chosen?.currency !== "USD") {
    fail("payments are USD only");
  }
  if (hold !== null && hold.expiresAt.getTime() <= attempt.createdAt.getTime()) {
    fail("a hold must expire after the attempt");
  }
}

/** The payment row `record` writes: INITIATED, with the ORDER request id, amount from the snapshot. */
export function initialPayment(input: RecordAttemptInput): Payment | null {
  const { attempt, payment } = input;
  if (payment === null) {
    return null;
  }
  const amount = attempt.decision.checkResult.chosen?.priceCents;
  if (amount == null) {
    throw new InvariantError(`attempt ${attempt.id}: a payment needs the chosen offer's price`);
  }
  return {
    attemptId: attempt.id,
    agentId: attempt.agentId,
    productId: attempt.productId,
    intent: payment.intent,
    status: "INITIATED",
    amountCents: amount,
    currency: "USD",
    paypalOrderId: null,
    authorizationId: null,
    captureId: null,
    failureReason: null,
    operations: [{ kind: "ORDER", requestId: payment.requestId, createdAt: attempt.createdAt }],
    createdAt: attempt.createdAt,
    updatedAt: attempt.createdAt,
  };
}

export function initialPaymentEvent(payment: Payment): PaymentEvent {
  return {
    attemptId: payment.attemptId,
    fromStatus: "NONE",
    toStatus: "INITIATED",
    detail: { requestId: payment.operations[0]?.requestId ?? null },
    at: payment.createdAt,
  };
}

export function initialHold(input: RecordAttemptInput): Hold | null {
  const { attempt, hold } = input;
  if (hold === null) {
    return null;
  }
  return {
    attemptId: attempt.id,
    status: "PENDING",
    createdAt: attempt.createdAt,
    expiresAt: hold.expiresAt,
    decidedAt: null,
    decidedBy: null,
  };
}

/** What a store must write for one payment transition; `event` and `operation` may be null. */
export interface PaymentPlan {
  result: TransitionResult;
  payment: Payment;
  changed: boolean;
  event: PaymentEvent | null;
  operation: PaymentOperation | null;
}

export function planPaymentTransition(
  current: Payment,
  to: PaymentStatus,
  input: PaymentTransitionInput,
): PaymentPlan {
  const kind = classifyPaymentMove(current.intent, current.status, to);
  if (kind === "illegal") {
    throw new IllegalTransitionError("payment", current.status, to);
  }
  if (kind === "stale") {
    return { result: "stale", payment: current, changed: false, event: null, operation: null };
  }

  const fields = applyPaymentPatch(current, input.patch ?? {});
  const fieldsChanged =
    fields.paypalOrderId !== current.paypalOrderId ||
    fields.authorizationId !== current.authorizationId ||
    fields.captureId !== current.captureId ||
    fields.failureReason !== current.failureReason;

  if (kind === "unchanged") {
    const payment = fieldsChanged ? { ...current, ...fields, updatedAt: input.now } : current;
    return { result: "unchanged", payment, changed: fieldsChanged, event: null, operation: null };
  }

  const missing = missingPaymentFields(to, fields);
  if (missing.length > 0) {
    throw new InvariantError(`payment ${current.attemptId}: ${to} requires ${missing.join(", ")}`);
  }

  const opKind = ENTRY_OPERATION[to];
  let operation: PaymentOperation | null = null;
  if (opKind !== undefined) {
    if (input.operationRequestId === undefined) {
      throw new InvariantError(`payment ${current.attemptId}: entering ${to} needs a request id`);
    }
    if (current.operations.some((op) => op.kind === opKind)) {
      throw new ConflictError(
        "OPERATION_EXISTS",
        `payment ${current.attemptId} already has a ${opKind} operation`,
      );
    }
    operation = { kind: opKind, requestId: input.operationRequestId, createdAt: input.now };
  } else if (input.operationRequestId !== undefined) {
    throw new InvariantError(
      `payment ${current.attemptId}: ${to} does not start a PayPal call; no request id expected`,
    );
  }

  const payment: Payment = {
    ...current,
    ...fields,
    status: to,
    operations: operation === null ? current.operations : [...current.operations, operation],
    updatedAt: input.now,
  };
  const event: PaymentEvent = {
    attemptId: current.attemptId,
    fromStatus: current.status,
    toStatus: to,
    detail: input.detail ?? null,
    at: input.now,
  };
  return { result: "applied", payment, changed: true, event, operation };
}

export type HoldAction =
  | { kind: "approve"; by: string; now: Date; requestId: RequestId }
  | { kind: "decline"; by: string; now: Date; requestId: RequestId }
  | { kind: "expire"; now: Date; requestId: RequestId };

const HOLD_TARGET: Readonly<Record<HoldAction["kind"], HoldStatus>> = {
  approve: "APPROVED",
  decline: "DECLINED",
  expire: "EXPIRED",
};

export interface HoldPlan {
  result: TransitionResult;
  hold: Hold;
  /** The payment move to write in the same transaction, if any. */
  paymentPlan: PaymentPlan | null;
}

/**
 * Plans an owner decision or an expiry. Approving needs an unexpired hold and, when a payment
 * exists, a confirmed authorization; it starts the capture in the same transaction. Declining or
 * expiring starts the void when the authorization is confirmed; an unconfirmed one is left for
 * the resolver, which voids it once it confirms.
 */
export function planHoldDecision(
  hold: Hold,
  payment: Payment | null,
  action: HoldAction,
): HoldPlan {
  const target = HOLD_TARGET[action.kind];
  const kind = classifyMove(HOLD_TRANSITIONS, hold.status, target);
  if (kind === "unchanged") {
    return { result: "unchanged", hold, paymentPlan: null };
  }
  if (kind !== "applied") {
    throw new HoldAlreadyDecidedError(hold.attemptId, hold.status);
  }

  const expired = action.now.getTime() >= hold.expiresAt.getTime();
  let paymentPlan: PaymentPlan | null = null;

  if (action.kind === "approve") {
    if (expired) {
      throw new HoldExpiredError(hold.attemptId);
    }
    if (payment !== null) {
      if (payment.status !== "AUTHORIZED") {
        throw new HoldNotReadyError(hold.attemptId, payment.status);
      }
      paymentPlan = planPaymentTransition(payment, "CAPTURING", {
        operationRequestId: action.requestId,
        detail: { hold: "APPROVED", by: action.by },
        now: action.now,
      });
    }
  } else {
    if (action.kind === "expire" && !expired) {
      throw new ConflictError("HOLD_NOT_EXPIRED", `hold ${hold.attemptId} has not expired yet`);
    }
    if (payment?.status === "AUTHORIZED") {
      paymentPlan = planPaymentTransition(payment, "VOIDING", {
        operationRequestId: action.requestId,
        detail: { hold: target },
        now: action.now,
      });
    }
  }

  return {
    result: "applied",
    hold: {
      ...hold,
      status: target,
      decidedAt: action.now,
      decidedBy: action.kind === "expire" ? SYSTEM_DECIDER : action.by,
    },
    paymentPlan,
  };
}

export function leaseKeyString(key: LeaseKey): string {
  return `${key.agentId}/${key.productId}`;
}
