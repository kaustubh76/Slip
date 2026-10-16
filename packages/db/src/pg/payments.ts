import {
  type HoldAction,
  type HoldRepo,
  MandateNotActiveError,
  NotFoundError,
  type PaymentPlan,
  type PaymentRepo,
  planApprovalWithFollowUp,
  planHoldDecision,
  planPaymentTransition,
} from "@slip/domain";
import { and, asc, desc, eq, gt, inArray, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import type { VaultCipher } from "../crypto.js";
import {
  attempts,
  holds,
  mandates,
  paymentEvents,
  paymentOperations,
  payments,
} from "../schema.js";
import { checkPage, recordInTransaction } from "./attempts.js";
import { guarded } from "./errors.js";
import { loadPayment, loadReceipts, requirePayment } from "./receipts.js";
import { toAttempt, toHold, toPayment, toPaymentEvent } from "./rows.js";

/** Payment rows with their operations, in the rows' order. */
async function withOperations(db: Db, rows: (typeof payments.$inferSelect)[]) {
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
}

/** Refuses unless the attempt's mandate is ACTIVE; holds a share lock on the mandate row. */
async function assertMandateActive(tx: Db, attemptId: string): Promise<void> {
  const [row] = await tx
    .select({ id: mandates.id, status: mandates.status })
    .from(attempts)
    .innerJoin(mandates, eq(mandates.id, attempts.mandateId))
    .where(eq(attempts.id, attemptId))
    .for("share", { of: mandates });
  if (row === undefined) {
    throw new NotFoundError("attempt", attemptId);
  }
  if (row.status !== "ACTIVE") {
    throw new MandateNotActiveError(row.id, row.status);
  }
}

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

    listStale: (statuses, updatedBefore, page) =>
      guarded(async () => {
        if (statuses.length === 0) {
          return [];
        }
        const { after } = page;
        const rows = await db
          .select()
          .from(payments)
          .where(
            and(
              inArray(payments.status, [...statuses]),
              lt(payments.updatedAt, updatedBefore),
              after === undefined
                ? undefined
                : or(
                    gt(payments.updatedAt, after.updatedAt),
                    and(
                      eq(payments.updatedAt, after.updatedAt),
                      gt(payments.attemptId, after.attemptId),
                    ),
                  ),
            ),
          )
          .orderBy(asc(payments.updatedAt), asc(payments.attemptId))
          .limit(page.limit);
        return withOperations(db, rows);
      }),

    listAuthorizedOnClosedHolds: (limit) =>
      guarded(async () => {
        const rows = await db
          .select({ payment: payments })
          .from(payments)
          .innerJoin(holds, eq(holds.attemptId, payments.attemptId))
          .where(
            and(eq(payments.status, "AUTHORIZED"), inArray(holds.status, ["DECLINED", "EXPIRED"])),
          )
          .orderBy(asc(payments.updatedAt), asc(payments.attemptId))
          .limit(limit);
        return withOperations(
          db,
          rows.map((row) => row.payment),
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

export function pgHolds(db: Db, cipher: VaultCipher): HoldRepo {
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
        if (action.kind === "approve" && plan.result === "applied") {
          // The kill switch: no approval moves money once the mandate is revoked. FOR SHARE makes
          // a concurrent revoke wait for this approval, or this approval see the revoke.
          await assertMandateActive(tx, attemptId);
        }
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

    listDecided: (mandateId, page) =>
      guarded(async () => {
        checkPage(page);
        const { after } = page;
        const rows = await db
          .select({ attempt: attempts })
          .from(holds)
          .innerJoin(attempts, eq(attempts.id, holds.attemptId))
          .where(
            and(
              eq(attempts.mandateId, mandateId),
              // A hold has a decision time exactly when it is no longer PENDING (holds_decided_fields).
              isNotNull(holds.decidedAt),
              after === undefined
                ? undefined
                : sql`(${holds.decidedAt}, ${holds.attemptId}) < (${after.decidedAt.toISOString()}::timestamptz, ${after.attemptId}::uuid)`,
            ),
          )
          .orderBy(desc(holds.decidedAt), desc(holds.attemptId))
          .limit(page.limit + 1);
        const items = await loadReceipts(
          db,
          rows.slice(0, page.limit).map((row) => row.attempt),
        );
        const last = items.at(-1);
        return {
          items,
          next:
            rows.length > page.limit && last?.hold?.decidedAt != null
              ? { decidedAt: last.hold.decidedAt, attemptId: last.attempt.id }
              : null,
        };
      }),

    listOpen: (agentId, productId) =>
      guarded(async () => {
        const rows = await db
          .select({ attempt: attempts })
          .from(holds)
          .innerJoin(attempts, eq(attempts.id, holds.attemptId))
          .where(
            and(
              eq(attempts.agentId, agentId),
              eq(attempts.productId, productId),
              eq(holds.status, "PENDING"),
            ),
          )
          .orderBy(desc(attempts.createdAt), desc(attempts.id));
        return loadReceipts(
          db,
          rows.map((row) => row.attempt),
        );
      }),

    listPendingOnRevokedMandates: (limit) =>
      guarded(async () => {
        const rows = await db
          .select({ attempt: attempts })
          .from(holds)
          .innerJoin(attempts, eq(attempts.id, holds.attemptId))
          .innerJoin(mandates, eq(mandates.id, attempts.mandateId))
          .where(and(eq(holds.status, "PENDING"), eq(mandates.status, "REVOKED")))
          .orderBy(asc(holds.createdAt), asc(holds.attemptId))
          .limit(limit);
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

    approveWithFollowUp: (input) =>
      guarded(() =>
        db.transaction(async (tx) => {
          const [row] = await tx
            .select()
            .from(holds)
            .where(eq(holds.attemptId, input.attemptId))
            .for("update");
          if (row === undefined) {
            throw new NotFoundError("hold", input.attemptId);
          }
          const [parentRow] = await tx
            .select()
            .from(attempts)
            .where(eq(attempts.id, input.attemptId));
          if (parentRow === undefined) {
            throw new NotFoundError("attempt", input.attemptId);
          }
          const approved = planApprovalWithFollowUp(
            toHold(row),
            toAttempt(parentRow),
            await loadPayment(tx, input.attemptId, "update"),
            { by: input.by, followUp: input.followUp },
          );
          // The follow-up runs every record check (lease, agent, ACTIVE mandate, current policy);
          // if any fails the transaction rolls back and the hold stays PENDING.
          const recorded = await recordInTransaction(tx, cipher, input.followUp);
          await tx
            .update(holds)
            .set({
              status: approved.status,
              decidedAt: approved.decidedAt,
              decidedBy: approved.decidedBy,
            })
            .where(eq(holds.attemptId, input.attemptId));
          const [stored] = await tx
            .select()
            .from(holds)
            .where(eq(holds.attemptId, input.attemptId));
          return { hold: toHold(stored as typeof holds.$inferSelect), recorded };
        }),
      ),
  };
}
