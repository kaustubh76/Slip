import { InvariantError, type Payment, type Receipt } from "@slip/domain";
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../client.js";
import { type attempts, holds, paymentOperations, payments } from "../schema.js";
import { toAttempt, toHold, toPayment } from "./rows.js";

/**
 * Builds receipts for attempt rows: three batched queries (payments, operations, holds) however
 * many attempts, order preserved.
 */
export async function loadReceipts(
  db: Db,
  rows: (typeof attempts.$inferSelect)[],
): Promise<Receipt[]> {
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.id);
  const [paymentRows, operationRows, holdRows] = await Promise.all([
    db.select().from(payments).where(inArray(payments.attemptId, ids)),
    db.select().from(paymentOperations).where(inArray(paymentOperations.attemptId, ids)),
    db.select().from(holds).where(inArray(holds.attemptId, ids)),
  ]);
  const paymentById = new Map(paymentRows.map((row) => [row.attemptId, row]));
  const holdById = new Map(holdRows.map((row) => [row.attemptId, row]));
  return rows.map((row) => {
    const payment = paymentById.get(row.id);
    const hold = holdById.get(row.id);
    return {
      attempt: toAttempt(row),
      payment:
        payment === undefined
          ? null
          : toPayment(
              payment,
              operationRows.filter((op) => op.attemptId === row.id),
            ),
      hold: hold === undefined ? null : toHold(hold),
    };
  });
}

/** One payment with its operations; `lock` takes a row lock for the rest of the transaction. */
export async function loadPayment(
  db: Db,
  attemptId: string,
  lock: "update" | "none",
): Promise<Payment | null> {
  const query = db.select().from(payments).where(eq(payments.attemptId, attemptId));
  const [row] = lock === "update" ? await query.for("update") : await query;
  if (row === undefined) {
    return null;
  }
  const operations = await db
    .select()
    .from(paymentOperations)
    .where(eq(paymentOperations.attemptId, attemptId));
  return toPayment(row, operations);
}

/** Same as `loadPayment` but the payment must exist. */
export async function requirePayment(db: Db, attemptId: string, lock: "update" | "none") {
  const payment = await loadPayment(db, attemptId, lock);
  if (payment === null) {
    throw new InvariantError(`payment ${attemptId} disappeared inside a transaction`);
  }
  return payment;
}
