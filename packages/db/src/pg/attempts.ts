import {
  type AttemptRepo,
  assertDirectRecord,
  assertRecordInvariants,
  ConflictError,
  InvariantError,
  initialHold,
  initialPayment,
  initialPaymentEvent,
  LeaseLostError,
  leaseKeyString,
  MandateNotActiveError,
  NotFoundError,
  type PageRequest,
  PolicyChangedError,
  type RecordAttemptInput,
  type RecordedAttempt,
  type SnapshotRepo,
} from "@slip/domain";
import { and, desc, eq, gte, type SQL, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { Conflict, MAX_PAGE_SIZE } from "../codes.js";
import type { VaultCipher } from "../crypto.js";
import {
  agents,
  attempts,
  checkoutLeases,
  holds,
  mandates,
  offerSnapshots,
  paymentEvents,
  paymentOperations,
  payments,
  policies,
} from "../schema.js";
import { guarded } from "./errors.js";
import { loadReceipts } from "./receipts.js";
import { attemptValues, paymentValues, toSnapshot } from "./rows.js";

export function pgSnapshots(db: Db): SnapshotRepo {
  return {
    save: (snapshot, raw) =>
      guarded(async () => {
        await db.insert(offerSnapshots).values({
          id: snapshot.id,
          productId: snapshot.productId,
          title: snapshot.title,
          selectedOptions: snapshot.selectedOptions,
          offers: snapshot.offers,
          raw: raw ?? null,
          rawHash: snapshot.rawHash,
          fetchedAt: snapshot.fetchedAt,
        });
      }),
    get: (id) =>
      guarded(async () => {
        const [row] = await db.select().from(offerSnapshots).where(eq(offerSnapshots.id, id));
        return row === undefined ? null : toSnapshot(row);
      }),
    getRaw: (id) =>
      guarded(async () => {
        const [row] = await db
          .select({ raw: offerSnapshots.raw })
          .from(offerSnapshots)
          .where(eq(offerSnapshots.id, id));
        return row === undefined ? null : { raw: row.raw };
      }),
    latestForProduct: (productId) =>
      guarded(async () => {
        const [row] = await db
          .select()
          .from(offerSnapshots)
          .where(eq(offerSnapshots.productId, productId))
          .orderBy(desc(offerSnapshots.fetchedAt), desc(offerSnapshots.id))
          .limit(1);
        return row === undefined ? null : toSnapshot(row);
      }),
  };
}

function checkPage(page: PageRequest): void {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > MAX_PAGE_SIZE) {
    throw new InvariantError(`page limit must be 1..${MAX_PAGE_SIZE}, got ${page.limit}`);
  }
}

/**
 * The checks and writes of `attempts.record`, inside the caller's transaction, so a hold approval
 * can write its follow-up attempt atomically with the hold (`holds.approveWithFollowUp`).
 */
export async function recordInTransaction(
  tx: Db,
  cipher: VaultCipher,
  input: RecordAttemptInput,
): Promise<RecordedAttempt> {
  assertRecordInvariants(input);
  const { attempt } = input;
  const payment = initialPayment(input);
  const hold = initialHold(input);
  const now = attempt.createdAt;
  const key = { agentId: attempt.agentId, productId: attempt.productId };

  // 1. The caller must still hold the checkout lease (fencing): if it expired and another
  //    checkout took over, this decision is stale and must not be written.
  const [lease] = await tx
    .select()
    .from(checkoutLeases)
    .where(
      and(
        eq(checkoutLeases.agentId, attempt.agentId),
        eq(checkoutLeases.productId, attempt.productId),
      ),
    )
    .for("update");
  if (
    lease === undefined ||
    lease.holder !== input.leaseHolder ||
    lease.expiresAt.getTime() <= now.getTime()
  ) {
    throw new LeaseLostError(leaseKeyString(key));
  }

  // 2. The agent is still allowed to act, under this mandate.
  const [agent] = await tx.select().from(agents).where(eq(agents.id, attempt.agentId)).for("share");
  if (agent === undefined) {
    throw new NotFoundError("agent", attempt.agentId);
  }
  if (agent.mandateId !== attempt.mandateId) {
    throw new InvariantError(`agent ${agent.id} does not act under mandate ${attempt.mandateId}`);
  }
  if (agent.revokedAt !== null) {
    throw new ConflictError(Conflict.AGENT_REVOKED, `agent ${agent.id} is revoked`);
  }

  // 3. The mandate is ACTIVE and the check ran under its current policy. FOR SHARE makes a
  //    concurrent revoke or policy edit wait until this decision is written.
  const [mandate] = await tx
    .select()
    .from(mandates)
    .where(eq(mandates.id, attempt.mandateId))
    .for("share");
  if (mandate === undefined) {
    throw new NotFoundError("mandate", attempt.mandateId);
  }
  if (mandate.status !== "ACTIVE") {
    throw new MandateNotActiveError(mandate.id, mandate.status);
  }
  const [current] = await tx
    .select({ version: policies.version })
    .from(policies)
    .where(eq(policies.mandateId, mandate.id))
    .orderBy(desc(policies.version))
    .limit(1);
  const checked = attempt.decision.checkResult.policyVersion;
  if (current === undefined || current.version !== checked) {
    throw new PolicyChangedError(checked, current?.version ?? 0);
  }

  // 4. Write the decision, then the write-ahead payment, its ORDER request id and the hold.
  await tx.insert(attempts).values(attemptValues(attempt));
  if (payment !== null) {
    await tx.insert(payments).values(paymentValues(payment, attempt.decision.outcome));
    for (const op of payment.operations) {
      await tx.insert(paymentOperations).values({
        attemptId: payment.attemptId,
        kind: op.kind,
        requestId: op.requestId,
        createdAt: op.createdAt,
      });
    }
    const event = initialPaymentEvent(payment);
    await tx.insert(paymentEvents).values({
      attemptId: event.attemptId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      detail: event.detail,
      at: event.at,
    });
  }
  if (hold !== null) {
    await tx.insert(holds).values({
      attemptId: hold.attemptId,
      attemptOutcome: attempt.decision.outcome,
      status: hold.status,
      createdAt: hold.createdAt,
      expiresAt: hold.expiresAt,
    });
  }

  const [stored] = await tx.select().from(attempts).where(eq(attempts.id, attempt.id));
  const [receipt] = await loadReceipts(tx, stored === undefined ? [] : [stored]);
  if (receipt === undefined) {
    throw new InvariantError(`attempt ${attempt.id} was not written`);
  }
  const vaultId =
    payment !== null && mandate.vaultIdCiphertext !== null
      ? cipher.decrypt(mandate.vaultIdCiphertext, mandate.id)
      : null;
  return { receipt, vaultId };
}

export function pgAttempts(db: Db, cipher: VaultCipher): AttemptRepo {
  const page = (filter: SQL, request: PageRequest) =>
    guarded(async () => {
      checkPage(request);
      const conditions = [filter];
      if (request.before !== undefined) {
        conditions.push(
          sql`(${attempts.createdAt}, ${attempts.id}) < (${request.before.createdAt.toISOString()}::timestamptz, ${request.before.id}::uuid)`,
        );
      }
      const rows = await db
        .select()
        .from(attempts)
        .where(and(...conditions))
        .orderBy(desc(attempts.createdAt), desc(attempts.id))
        .limit(request.limit + 1);
      const items = await loadReceipts(db, rows.slice(0, request.limit));
      const last = items.at(-1);
      return {
        items,
        next:
          rows.length > request.limit && last !== undefined
            ? { createdAt: last.attempt.createdAt, id: last.attempt.id }
            : null,
      };
    });

  return {
    record: (input) =>
      guarded(async () => {
        assertDirectRecord(input);
        return db.transaction((tx) => recordInTransaction(tx, cipher, input));
      }),

    get: (id) =>
      guarded(async () => {
        const rows = await db.select().from(attempts).where(eq(attempts.id, id));
        const [receipt] = await loadReceipts(db, rows);
        return receipt ?? null;
      }),

    listRecent: (agentId, productId, since) =>
      guarded(async () => {
        const rows = await db
          .select()
          .from(attempts)
          .where(
            and(
              eq(attempts.agentId, agentId),
              eq(attempts.productId, productId),
              gte(attempts.createdAt, since),
            ),
          )
          .orderBy(desc(attempts.createdAt), desc(attempts.id));
        return loadReceipts(db, rows);
      }),

    listByAgent: (agentId, request) => page(eq(attempts.agentId, agentId), request),

    listByMandate: (mandateId, request) => page(eq(attempts.mandateId, mandateId), request),

    findChild: (parentId) =>
      guarded(async () => {
        const rows = await db.select().from(attempts).where(eq(attempts.parentAttemptId, parentId));
        const [receipt] = await loadReceipts(db, rows);
        return receipt ?? null;
      }),
  };
}
