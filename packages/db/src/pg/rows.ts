import {
  type Agent,
  type Attempt,
  type AttemptOrigin,
  agentId,
  attemptId,
  CHECK_RESULT_VERSION,
  cents,
  type Hold,
  type HoldStatus,
  InvariantError,
  type Mandate,
  type MandateStatus,
  mandateId,
  type OfferSnapshot,
  OfferSnapshotSchema,
  type Outcome,
  type Owner,
  ownerId,
  type Payment,
  type PaymentEvent,
  type PaymentIntent,
  type PaymentOperation,
  type PaymentOperationKind,
  type PaymentStatus,
  type Policy,
  PolicySchema,
  parseStoredCheckResult,
  type RuleCode,
  requestId,
  SelectedOptionSchema,
} from "@slip/domain";
import { z } from "zod";
/**
 * The rows of a raw statement. postgres.js answers with an array, PGlite with `{ rows }`; both
 * drivers run the same SQL, so the difference is normalised in one place.
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) {
    return result as T[];
  }
  return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

import type {
  agents,
  attempts,
  holds,
  mandates,
  offerSnapshots,
  owners,
  paymentEvents,
  paymentOperations,
  payments,
  policies,
} from "../schema.js";

/**
 * Row ↔ domain mapping. Rows are validated on the way out: a row that no longer fits the domain
 * (manual edits, a bad migration) fails loudly instead of flowing into a payment decision.
 */

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

const SelectedOptionsSchema = z.array(SelectedOptionSchema).nullable();

export function toOwner(row: Row<typeof owners>): Owner {
  return { id: ownerId(row.id), email: row.email, createdAt: row.createdAt };
}

export function toMandate(row: Row<typeof mandates>): Mandate {
  return {
    id: mandateId(row.id),
    ownerId: ownerId(row.ownerId),
    status: row.status as MandateStatus,
    setupOrderId: row.setupOrderId,
    paypalCustomerId: row.paypalCustomerId,
    hasVaultId: row.vaultIdCiphertext !== null,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
    revokedAt: row.revokedAt,
    vaultDeletedAt: row.vaultDeletedAt,
    reconciledAt: row.reconciledAt,
    reconcileUnmatched: row.reconcileUnmatched,
  };
}

export function toPolicy(row: Row<typeof policies>): Policy {
  return PolicySchema.parse({
    version: row.version,
    maxOverpayPctHundredths: row.maxOverpayPctHundredths,
    maxOverpayAbsCents: row.maxOverpayAbsCents,
    flagPctHundredths: row.flagPctHundredths,
    orderCapCents: row.orderCapCents,
    snapshotMaxAgeMs: row.snapshotMaxAgeMs,
  });
}

export function toAgent(row: Row<typeof agents>): Agent {
  return {
    id: agentId(row.id),
    mandateId: mandateId(row.mandateId),
    name: row.name,
    apiKeyPrefix: row.apiKeyPrefix,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}

export function toSnapshot(row: Row<typeof offerSnapshots>): OfferSnapshot {
  return OfferSnapshotSchema.parse({
    id: row.id,
    productId: row.productId,
    title: row.title,
    selectedOptions: row.selectedOptions,
    offers: row.offers,
    rawHash: row.rawHash,
    fetchedAt: row.fetchedAt,
  });
}

export function toAttempt(row: Row<typeof attempts>): Attempt {
  const checkResult = parseStoredCheckResult(row.checkResultVersion, row.checkResult);
  if (checkResult.ruleCode !== row.ruleCode) {
    throw new InvariantError(`attempt ${row.id}: rule_code column disagrees with check_result`);
  }
  return {
    id: attemptId(row.id),
    agentId: agentId(row.agentId),
    mandateId: mandateId(row.mandateId),
    productId: row.productId,
    origin: row.origin as AttemptOrigin,
    parentAttemptId: row.parentAttemptId === null ? null : attemptId(row.parentAttemptId),
    chosenOfferUrl: row.chosenOfferUrl,
    selectedOptions: SelectedOptionsSchema.parse(row.selectedOptions),
    reason: row.reason,
    decision: {
      outcome: row.outcome as Outcome,
      ruleCode: row.ruleCode as RuleCode,
      checkResult,
    },
    createdAt: row.createdAt,
  };
}

/** Insert values for an attempt; the denormalised columns come from the same check result. */
export function attemptValues(attempt: Attempt): typeof attempts.$inferInsert {
  const result = attempt.decision.checkResult;
  return {
    id: attempt.id,
    agentId: attempt.agentId,
    mandateId: attempt.mandateId,
    productId: attempt.productId,
    origin: attempt.origin,
    parentAttemptId: attempt.parentAttemptId,
    chosenOfferUrl: attempt.chosenOfferUrl,
    selectedOptions: attempt.selectedOptions,
    reason: attempt.reason,
    snapshotId: result.snapshotId,
    policyVersion: result.policyVersion,
    outcome: attempt.decision.outcome,
    ruleCode: attempt.decision.ruleCode,
    ruleCodes: result.ruleCodes,
    gapAbsCents: result.gapAbsCents,
    gapPctHundredths: result.gapPctHundredths,
    chosenPriceCents: result.chosen?.priceCents ?? null,
    bestPriceCents: result.best?.priceCents ?? null,
    conflict: result.conflict,
    checkResultVersion: CHECK_RESULT_VERSION,
    checkResult: result,
    createdAt: attempt.createdAt,
  };
}

const OPERATION_ORDER: readonly PaymentOperationKind[] = ["ORDER", "CAPTURE", "VOID"];

export function toOperation(row: Row<typeof paymentOperations>): PaymentOperation {
  return {
    kind: row.kind as PaymentOperationKind,
    requestId: requestId(row.requestId),
    createdAt: row.createdAt,
  };
}

export function toPayment(
  row: Row<typeof payments>,
  operations: Row<typeof paymentOperations>[],
): Payment {
  return {
    attemptId: attemptId(row.attemptId),
    agentId: agentId(row.agentId),
    productId: row.productId,
    intent: row.intent as PaymentIntent,
    status: row.status as PaymentStatus,
    amountCents: cents(row.amountCents),
    currency: "USD",
    paypalOrderId: row.paypalOrderId,
    authorizationId: row.authorizationId,
    captureId: row.captureId,
    failureReason: row.failureReason,
    operations: operations
      .map(toOperation)
      .sort((a, b) => OPERATION_ORDER.indexOf(a.kind) - OPERATION_ORDER.indexOf(b.kind)),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Insert values for a payment created by `record`; outcome copied for the composite key. */
export function paymentValues(payment: Payment, outcome: Outcome): typeof payments.$inferInsert {
  return {
    attemptId: payment.attemptId,
    attemptOutcome: outcome,
    agentId: payment.agentId,
    productId: payment.productId,
    intent: payment.intent,
    status: payment.status,
    amountCents: payment.amountCents,
    currency: payment.currency,
    paypalOrderId: payment.paypalOrderId,
    authorizationId: payment.authorizationId,
    captureId: payment.captureId,
    failureReason: payment.failureReason,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

export function toPaymentEvent(row: Row<typeof paymentEvents>): PaymentEvent {
  return {
    attemptId: attemptId(row.attemptId),
    fromStatus: row.fromStatus as PaymentStatus,
    toStatus: row.toStatus as PaymentStatus,
    detail: row.detail ?? null,
    at: row.at,
  };
}

export function toHold(row: Row<typeof holds>): Hold {
  return {
    attemptId: attemptId(row.attemptId),
    status: row.status as HoldStatus,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy,
  };
}
