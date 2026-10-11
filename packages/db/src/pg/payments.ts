import {
  type HoldAction,
  type HoldRepo,
  NotFoundError,
  type PaymentPlan,
  type PaymentRepo,
  planHoldDecision,
  planPaymentTransition,
} from "@slip/domain";
import { and, asc, eq, inArray, lt, lte, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../client.js";
import { attempts, holds, paymentEvents, paymentOperations, payments } from "../schema.js";
import { guarded } from "./errors.js";
import { loadPayment, loadReceipts, requirePayment } from "./receipts.js";
import { toHold, toPayment, toPaymentEvent } from "./rows.js";

/** Writes a planned payment move: the row, its new operation and its event, in the caller's tx. */
async function writePaymentPlan(tx: Db, plan: PaymentPlan): Promise<void> {
  if (!plan.changed) {
    return;
  }
  const { payment } = plan;
  await tx
    .update(payments)
    .set({
      status: payment.status,
      paypalOrderId: payment.paypalOrderId,
      authorizationId: payment.authorizationId,
      captureId: payment.captureId,
      failureReason: payment.failureReason,
      updatedAt: payment.updatedAt,
    })
    .where(eq(payments.attemptId, payment.attemptId));
  if (plan.operation !== null) {
    await tx.insert(paymentOperations).values({
      attemptId: payment.attemptId,
      kind: plan.operation.kind,
      requestId: plan.operation.requestId,
      createdAt: plan.operation.createdAt,
    });
  }
  if (plan.event !== null) {
    await tx.insert(paymentEvents).values({
      attemptId: plan.event.attemptId,
      fromStatus: plan.event.fromStatus,
      toStatus: plan.event.toStatus,
      detail: plan.event.detail ?? null,
      at: plan.event.at,
    });
  }
}

export function pgPayments(db: Db): PaymentRepo {
  return {
    get: (attemptId) => guarded(() => loadPayment(db, attemptId, "none")),

    findByRequestId: (requestId) =>
      guarded(async () => {
        const [op] = await db
          .select({ attemptId: paymentOperations.attemptId })
          .from(paymentOperations)
          .where(eq(paymentOperations.requestId, requestId));
        return op === undefined ? null : loadPayment(db, op.attemptId, "none");
      }),

    findByPaypalOrderId: (orderId) =>
      guarded(async () => {
        const [row] = await db
          .select({ attemptId: payments.attemptId })
          .from(payments)
          .where(eq(payments.paypalOrderId, orderId));
        return row === undefined ? null : loadPayment(db, row.attemptId, "none");
      }),

    transition: (attemptId, to, input) =>
      guarded(() =>
        db.transaction(async (tx) => {
          const current = await loadPayment(tx, attemptId, "update");
          if (current === null) {
            throw new NotFoundError("payment", attemptId);
          }
          const plan = planPaymentTransition(current, to, input);
          await writePaymentPlan(tx, plan);
          return { value: await requirePayment(tx, attemptId, "none"), result: plan.result };
        }),
      ),

    listStale: (statuses, updatedBefore, limit) =>
      guarded(async () => {
        if (statuses.length === 0) {
          return [];
        }
        const rows = await db
          .select()
          .from(payments)
          .where(
            and(inArray(payments.status, [...statuses]), lt(payments.updatedAt, updatedBefore)),
          )
          .orderBy(asc(payments.updatedAt), asc(payments.attemptId))
          .limit(limit);
        if (rows.length === 0) {
          return [];
        }
        const ops = await db
          .select()
          .from(paymentOperations)
          .where(
            inArray(
              paymentOperations.attemptId,
              rows.map((row) => row.attemptId),
            ),
          );
        return rows.map((row) =>
          toPayment(
            row,
            ops.filter((op) => op.attemptId === row.attemptId),
          ),
        );
      }),

    events: (attemptId) =>
      guarded(async () => {
        const rows = await db
          .select()
          .from(paymentEvents)
          .where(eq(paymentEvents.attemptId, attemptId))
          .orderBy(asc(paymentEvents.id));
        return rows.map(toPaymentEvent);
      }),
  };
}

export function pgHolds(db: Db): HoldRepo {
  const decide = (attemptId: string, action: HoldAction) =>
    guarded(() =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(holds)
          .where(eq(holds.attemptId, attemptId))
          .for("update");
        if (row === undefined) {
          throw new NotFoundError("hold", attemptId);
        }
        const payment = await loadPayment(tx, attemptId, "update");
        const plan = planHoldDecision(toHold(row), payment, action);
        if (plan.result === "applied") {
          await tx
            .update(holds)
            .set({
              status: plan.hold.status,
              decidedAt: plan.hold.decidedAt,
              decidedBy: plan.hold.decidedBy,
            })
            .where(eq(holds.attemptId, attemptId));
        }
        if (plan.paymentPlan !== null) {
          await writePaymentPlan(tx, plan.paymentPlan);
        }
        const [stored] = await tx.select().from(holds).where(eq(holds.attemptId, attemptId));
        return {
          hold: toHold(stored as typeof holds.$inferSelect),
          payment: await loadPayment(tx, attemptId, "none"),
          result: plan.result,
        };
      }),
    );

  return {
    get: (attemptId) =>
      guarded(async () => {
        const [row] = await db.select().from(holds).where(eq(holds.attemptId, attemptId));
        return row === undefined ? null : toHold(row);
      }),

    approve: (attemptId, input) =>
      decide(attemptId, {
        kind: "approve",
        by: input.by,
        now: input.now,
        requestId: input.captureRequestId,
      }),

    decline: (attemptId, input) =>
      decide(attemptId, {
        kind: "decline",
        by: input.by,
        now: input.now,
        requestId: input.voidRequestId,
      }),

    expire: (attemptId, input) =>
      decide(attemptId, { kind: "expire", now: input.now, requestId: input.voidRequestId }),

    listPending: (mandateId) =>
      guarded(async () => {
        const rows = await db
          .select({ attempt: attempts })
          .from(holds)
          .innerJoin(attempts, eq(attempts.id, holds.attemptId))
          .where(and(eq(attempts.mandateId, mandateId), eq(holds.status, "PENDING")))
          .orderBy(asc(holds.createdAt), asc(holds.attemptId));
        return loadReceipts(
          db,
          rows.map((row) => row.attempt),
        );
      }),

    listExpiring: (now, limit) =>
      guarded(async () => {
        const rows = await db
          .select()
          .from(holds)
          .where(and(eq(holds.status, "PENDING"), lte(holds.expiresAt, now)))
          .orderBy(asc(holds.expiresAt), asc(holds.attemptId))
          .limit(limit);
        return rows.map(toHold);
      }),

    listApprovedAwaitingPayment: (limit) =>
      guarded(async () => {
        const child = alias(attempts, "child");
        const rows = await db
          .select({ attempt: attempts })
          .from(holds)
          .innerJoin(attempts, eq(attempts.id, holds.attemptId))
          .where(
            and(
              eq(holds.status, "APPROVED"),
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(payments)
                  .where(eq(payments.attemptId, holds.attemptId)),
              ),
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(child)
                  .where(eq(child.parentAttemptId, holds.attemptId)),
              ),
            ),
          )
          .orderBy(asc(holds.decidedAt), asc(holds.attemptId))
          .limit(limit);
        return loadReceipts(
          db,
          rows.map((row) => row.attempt),
        );
      }),
  };
}
