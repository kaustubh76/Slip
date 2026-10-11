import { type Attempt, RULE_OUTCOME } from "./attempt.js";
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

/** `attempts.record` takes the agent's own attempts only (see `planApprovalWithFollowUp`). */
export function assertDirectRecord(input: RecordAttemptInput): void {
  if (input.attempt.origin !== "AGENT") {
    throw new InvariantError(
      `attempt ${input.attempt.id}: an OWNER_APPROVAL attempt is recorded together with its hold approval`,
    );
  }
}

/**
 * Plans the approval of a hold that has no live authorization, paid by a follow-up attempt. Returns
 * the approved hold; the store writes it in the same transaction as `record(followUp)`.
 *
 * Allowed only when the held attempt has no payment, or one that PayPal failed or voided
 * **before any capture** — a hold whose capture was attempted already had its approval, and a
 * follow-up would charge again without asking. A live authorization is approved by capturing it
 * (`holds.approve`); one not yet settled is `HoldNotReadyError`.
 */
export function planApprovalWithFollowUp(
  hold: Hold,
  parent: Attempt,
  parentPayment: Payment | null,
  input: { by: string; followUp: RecordAttemptInput },
): Hold {
  const { followUp } = input;
  const child = followUp.attempt;
  const now = child.createdAt;

  if (hold.status !== "PENDING") {
    throw new HoldAlreadyDecidedError(hold.attemptId, hold.status);
  }
  if (now.getTime() >= hold.expiresAt.getTime()) {
    throw new HoldExpiredError(hold.attemptId);
  }

  if (parentPayment !== null) {
    const captureTried = parentPayment.operations.some((op) => op.kind === "CAPTURE");
    const deadBeforeCapture =
      (parentPayment.status === "FAILED" || parentPayment.status === "VOIDED") && !captureTried;
    if (!deadBeforeCapture) {
      if (parentPayment.status === "AUTHORIZED") {
        throw new InvariantError(
          `hold ${hold.attemptId} has a live authorization; approve it by capturing (holds.approve)`,
        );
      }
      if (["INITIATED", "UNKNOWN", "PENDING"].includes(parentPayment.status)) {
        throw new HoldNotReadyError(hold.attemptId, parentPayment.status);
      }
      throw new InvariantError(
        `hold ${hold.attemptId}: a capture was already attempted (payment ${parentPayment.status}); no follow-up`,
      );
    }
  }

  const fail = (rule: string): never => {
    throw new InvariantError(`follow-up ${child.id} for hold ${hold.attemptId}: ${rule}`);
  };
  if (child.origin !== "OWNER_APPROVAL" || child.parentAttemptId !== hold.attemptId) {
    fail("must be an OWNER_APPROVAL attempt whose parent is this hold");
  }
  if (
    child.agentId !== parent.agentId ||
    child.productId !== parent.productId ||
    child.mandateId !== parent.mandateId
  ) {
    fail("must be for the same agent, product and mandate as the held attempt");
  }
  if (child.decision.outcome !== "PAID" || child.decision.ruleCode !== "OWNER_APPROVED") {
    fail("must be PAID by OWNER_APPROVED (a re-check that rejects is refused, not recorded)");
  }
  if (followUp.payment?.intent !== "CAPTURE" || followUp.hold !== null) {
    fail("pays in one step: a CAPTURE payment and no hold");
  }
  assertRecordInvariants(followUp);

  return { ...hold, status: "APPROVED", decidedAt: now, decidedBy: input.by };
}

export function leaseKeyString(key: LeaseKey): string {
  return `${key.agentId}/${key.productId}`;
}
