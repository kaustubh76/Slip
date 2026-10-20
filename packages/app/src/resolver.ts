import {
  attemptId,
  type Cursor,
  isUuid,
  type Payment,
  type PaymentStatus,
  type Receipt,
  requestId,
  type SettlementRecord,
  type StaleCursor,
  SYSTEM_DECIDER,
} from "@slip/domain";
import type { AppDeps } from "./deps.js";
import { closeHold } from "./holds.js";
import { pollSetup } from "./mandates.js";
import { afterLookup, afterOrderRead } from "./outcomes.js";
import {
  applyStep,
  callPayPal,
  operation,
  orderDescription,
  releaseAuthorization,
  sendCapture,
  sendOrder,
  sendVoid,
} from "./payments.js";
import { deleteVaultToken } from "./vault.js";
import { processWebhook } from "./webhooks.js";

/**
 * The resolver finishes what a request could not: PayPal calls that timed out, holds whose time
 * ran out, revokes that stopped half-way, setups the owner approved without coming back, webhooks
 * that could not be applied when they arrived. It runs on a schedule; every action is idempotent or a
 * compare-and-set, so two runs that overlap cannot move money twice.
 *
 * Each item is handled on its own: one that throws is logged and counted, and the rest go on.
 */

export const RESOLVER_TASKS = [
  "webhooks",
  "expireHolds",
  "finishRevokes",
  "deleteVaultTokens",
  "orders",
  "holdOperations",
  "setups",
  "closedHolds",
  "reconcile",
] as const;
export type ResolverTask = (typeof RESOLVER_TASKS)[number];

/** `settled`: nothing more to do. `waiting`: left for a later run. `failed`: threw. */
export interface TaskCount {
  settled: number;
  waiting: number;
  failed: number;
}
export type ResolverReport = Record<ResolverTask, TaskCount>;

type Handled = "settled" | "waiting";
type StalePage = { limit: number; after?: StaleCursor };

const paymentCursor = (p: Payment): StaleCursor => ({
  updatedAt: p.updatedAt,
  attemptId: p.attemptId,
});
const paymentKey = (p: Payment): string => p.attemptId;

/**
 * Slip's books against PayPal's own, once a day per permission (D75).
 *
 * Only one direction is checked, and it is the one nothing else can see: a transaction PayPal
 * recorded under one of this permission's attempts that Slip cannot account for. The other
 * direction — Slip believes a payment moved and PayPal has not listed it — is what the resolver's
 * own order lookup already chases, down to declaring it FAILED after a day.
 *
 * Two things keep it from crying wolf. The window ends `reportingLagMs` ago, because reporting
 * lags and a fresh "no" means nothing; and a payment still in flight is never counted, because
 * disagreeing with PayPal is the resolver's job, not this one's. Only a payment that is absent,
 * FAILED or VOIDED while PayPal settled money is unaccounted for.
 *
 * PayPal is asked once per pass, not once per permission: one merchant account serves them all.
 */
async function reconcile(deps: AppDeps, run: Run, limit: number): Promise<void> {
  const now = deps.clock.now();
  const dueBefore = new Date(now.getTime() - deps.config.reconcileEveryMs);
  // A permission revoked longer ago than the window reaches back cannot acquire a new settlement
  // Slip has not already seen, so it stops being examined rather than being examined for ever.
  const revokedAfter = new Date(
    now.getTime() - deps.config.reportingLagMs - deps.config.reconcileWindowMs,
  );
  // Asked once, before PayPal: there is no point spending a call on nobody.
  if ((await deps.store.mandates.listDueForReconcile(dueBefore, revokedAfter, 1)).length === 0) {
    return;
  }
  const to = new Date(now.getTime() - deps.config.reportingLagMs);
  const listed = await callPayPal(deps, "settlement list", (signal) =>
    deps.gateway.listSettlements(
      { from: new Date(to.getTime() - deps.config.reconcileWindowMs), to },
      signal,
    ),
  );
  if (listed.kind !== "listed") {
    // Slip has not looked, so it may not conclude anything — and must not stamp an "as of" that
    // would tell an owner it had.
    deps.log.error("reconcile.unanswered", { reason: listed.reason });
    return;
  }

  const byInvoice = [...netByInvoice(listed.records)];
  const mine = byInvoice.filter(([invoiceId]) => isUuid(invoiceId));
  const strangers = byInvoice.length - mine.length;
  const unmatched = new Map<string, number>();
  let orphans = 0;
  // Bounded, and in parallel: a window can hold MAX_PAGES x PAGE_SIZE records, and one
  // round-trip each in series would outlast the pass that called this.
  await inParallel(mine, deps.config.resolverConcurrency, async ([invoiceId, paypalCents]) => {
    const receipt = await deps.store.attempts.get(attemptId(invoiceId));
    if (receipt === null) {
      // Another application on the same merchant account, or a record Slip never made. Not this
      // owner's business, and not a number to put in front of them.
      orphans += 1;
      return;
    }
    const slipCents = slipBelieves(receipt.payment);
    if (slipCents === null || slipCents === paypalCents) {
      return;
    }
    const mandate = receipt.attempt.mandateId as string;
    unmatched.set(mandate, (unmatched.get(mandate) ?? 0) + 1);
    deps.log.error("reconcile.disagreed", {
      attemptId: invoiceId,
      mandateId: mandate,
      slipCents,
      paypalCents,
    });
  });
  if (strangers + orphans > 0) {
    deps.log.warn("reconcile.unknown_transactions", { count: strangers + orphans });
  }

  // Stamped through `drain`, so one permission that throws is counted and the rest still get
  // their answer; each leaves the list as its own "as of" moves forward.
  await run.drain(
    "reconcile",
    () => deps.store.mandates.listDueForReconcile(dueBefore, revokedAfter, limit),
    (mandate) => mandate.id,
    async (mandate) => {
      const count = unmatched.get(mandate.id as string) ?? 0;
      await deps.store.mandates.recordReconcile(mandate.id, { at: now, unmatched: count });
      if (count > 0) {
        deps.log.error("reconcile.unmatched", { mandateId: mandate.id, count });
      }
      return "settled";
    },
  );
}

/**
 * What PayPal's records add up to, per invoice, in cents. Settlements and reversals both count,
 * with their signs: a capture and its refund net to zero, a partial refund to the difference, and
 * two captures of the same invoice to twice the amount — which is the only place a double charge
 * could ever surface, since Slip's own payments table holds one row per attempt.
 *
 * Pending records are left out. They are PayPal still deciding, and disagreeing with that is the
 * resolver's other tasks' work, not this one's.
 */
function netByInvoice(records: readonly SettlementRecord[]): Map<string, number> {
  const net = new Map<string, number>();
  for (const record of records) {
    if (record.kind === "settled" || record.kind === "reversed") {
      net.set(record.invoiceId, (net.get(record.invoiceId) ?? 0) + record.amountCents);
    }
  }
  return net;
}

/**
 * What Slip's books say moved, in cents — or null while it cannot say.
 *
 * Captured means the amount; absent, failed or voided means nothing moved. Everything else is in
 * flight, and a payment in flight is the resolver's other tasks' argument with PayPal, not this
 * one's: counting it here would flag the same purchase every day until it settled.
 */
function slipBelieves(payment: Payment | null): number | null {
  if (payment === null) {
    return 0;
  }
  if (payment.status === "CAPTURED") {
    return payment.amountCents;
  }
  return payment.status === "FAILED" || payment.status === "VOIDED" ? 0 : null;
}

/** Searching from a little before the decision, in case PayPal's clock runs behind ours. */
const LOOKUP_SKEW_MS = 10 * 60_000;

const ORDER_OPEN: readonly PaymentStatus[] = ["INITIATED", "UNKNOWN", "PENDING"];
const OPERATION_OPEN: readonly PaymentStatus[] = ["CAPTURING", "VOIDING"];

export async function runResolver(deps: AppDeps): Promise<ResolverReport> {
  const started = deps.clock.now();
  const report = Object.fromEntries(
    RESOLVER_TASKS.map((task) => [task, { settled: 0, waiting: 0, failed: 0 }]),
  ) as ResolverReport;
  const run = new Run(deps, report);
  const limit = deps.config.resolverBatchSize;

  // What PayPal already told us comes first, so nothing below asks it again needlessly. An event
  // younger than the quiet period may still be in the hands of the request that received it.
  const quietSince = new Date(started.getTime() - deps.config.resolverMinAgeMs);
  await run.drain(
    "webhooks",
    async () =>
      (await deps.store.webhooks.listUnprocessed(limit)).filter(
        (event) => event.receivedAt.getTime() < quietSince.getTime(),
      ),
    (event) => event.id,
    async (event) => {
      await processWebhook(deps, event);
      return "settled";
    },
  );

  // Then holds: an expiry or a finished revoke closes a hold before its payment is looked at,
  // so no order is re-sent for a hold that is already closed.
  await run.drain(
    "expireHolds",
    () => deps.store.holds.listExpiring(deps.clock.now(), limit),
    (hold) => hold.attemptId,
    async (hold) => {
      const expired = await deps.store.holds.expire(hold.attemptId, {
        now: deps.clock.now(),
        voidRequestId: requestId(deps.ids.uuid()),
      });
      if (expired.result === "applied") {
        deps.log.info("hold.expired", { attemptId: hold.attemptId });
      }
      if (expired.result === "applied" && expired.payment?.status === "VOIDING") {
        const voided = await sendVoid(deps, expired.payment);
        return voided.status === "VOIDING" ? "waiting" : "settled";
      }
      return "settled";
    },
  );

  await run.drain(
    "finishRevokes",
    () => deps.store.holds.listPendingOnRevokedMandates(limit),
    (receipt) => receipt.attempt.id,
    async (receipt) => {
      const closed = await closeHold(deps, receipt, SYSTEM_DECIDER);
      return closed.status === "done" && closed.receipt.payment?.status === "VOIDING"
        ? "waiting"
        : "settled";
    },
  );

  await run.drain(
    "deleteVaultTokens",
    () => deps.store.mandates.listAwaitingVaultDeletion(limit),
    (mandate) => mandate.id,
    async (mandate) =>
      (await deleteVaultToken(deps, mandate.id)) === "failed" ? "waiting" : "settled",
  );

  const stalePayments = (statuses: readonly PaymentStatus[]) => (page: StalePage) =>
    deps.store.payments.listStale(statuses, quietSince, page);
  await run.pages("orders", stalePayments(ORDER_OPEN), paymentCursor, paymentKey, (payment) =>
    resolveOrder(deps, payment),
  );
  await run.pages(
    "holdOperations",
    stalePayments(OPERATION_OPEN),
    paymentCursor,
    paymentKey,
    (payment) => resolveHoldOperation(deps, payment),
  );

  await run.pages(
    "setups",
    (page: { limit: number; after?: Cursor }) =>
      deps.store.mandates.listPendingSetup(
        new Date(started.getTime() - deps.config.setupPollAfterMs),
        page,
      ),
    (mandate): Cursor => ({ createdAt: mandate.createdAt, id: mandate.id }),
    (mandate) => mandate.id,
    async (mandate) => {
      const state = await pollSetup(deps, mandate);
      return state === "active" || state === "revoked" ? "settled" : "waiting";
    },
  );

  // Last, so an authorization a lookup just confirmed for a closed hold is released this run.
  await run.drain(
    "closedHolds",
    () => deps.store.payments.listAuthorizedOnClosedHolds(limit),
    (payment) => payment.attemptId,
    async (payment) => {
      const released = await releaseAuthorization(
        deps,
        payment,
        "hold closed before PayPal confirmed",
      );
      return released.status === "VOIDING" ? "waiting" : "settled";
    },
  );

  // After everything else, so what this run settled is already in Slip's books before they are
  // compared with PayPal's.
  await reconcile(deps, run, limit);

  deps.log.info("resolver.finished", {
    ms: deps.clock.now().getTime() - started.getTime(),
    ...Object.fromEntries(RESOLVER_TASKS.map((task) => [task, report[task]])),
  });
  return report;
}

class Run {
  readonly #deps: AppDeps;
  readonly #report: ResolverReport;

  constructor(deps: AppDeps, report: ResolverReport) {
    this.#deps = deps;
    this.#report = report;
  }

  /**
   * For lists an item leaves once handled: fetch, handle, fetch again while pages come back full.
   * An item that stays (it failed, or must wait) is not handled twice in one run.
   */
  async drain<T>(
    task: ResolverTask,
    fetch: () => Promise<T[]>,
    key: (item: T) => string,
    handle: (item: T) => Promise<Handled>,
  ): Promise<void> {
    const seen = new Set<string>();
    const limit = this.#deps.config.resolverBatchSize;
    for (;;) {
      const page = await fetch();
      const fresh = page.filter((item) => !seen.has(key(item)));
      if (fresh.length === 0) {
        return;
      }
      for (const item of fresh) {
        seen.add(key(item));
      }
      await this.#each(task, fresh, key, handle);
      if (page.length < limit) {
        return;
      }
    }
  }

  /** For items that may have to wait: every page once, by cursor, so none hides another. */
  async pages<T, C>(
    task: ResolverTask,
    fetch: (page: { limit: number; after?: C }) => Promise<T[]>,
    cursor: (last: T) => C,
    key: (item: T) => string,
    handle: (item: T) => Promise<Handled>,
  ): Promise<void> {
    const limit = this.#deps.config.resolverBatchSize;
    let after: C | undefined;
    for (;;) {
      const page = await fetch(after === undefined ? { limit } : { limit, after });
      const last = page.at(-1);
      if (last === undefined) {
        return;
      }
      await this.#each(task, page, key, handle);
      if (page.length < limit) {
        return;
      }
      after = cursor(last);
    }
  }

  /** Up to `resolverConcurrency` items at once; each one's failure is its own. */
  async #each<T>(
    task: ResolverTask,
    items: T[],
    key: (item: T) => string,
    handle: (item: T) => Promise<Handled>,
  ): Promise<void> {
    const count = this.#report[task];
    await inParallel(items, this.#deps.config.resolverConcurrency, async (item) => {
      try {
        count[await handle(item)] += 1;
      } catch (error) {
        count.failed += 1;
        this.#deps.log.error("resolver.item_failed", {
          task,
          id: key(item),
          error: String(error),
        });
      }
    });
  }
}

/**
 * Up to `limit` items at once, in order, each one's turn taken as a worker frees up. The one
 * bounded loop in this file: the resolver's tasks use it through `Run`, and the reconcile uses it
 * directly for the lookups it does outside a task.
 */
async function inParallel<T>(
  items: readonly T[],
  limit: number,
  handle: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (let item = items[next++]; item !== undefined; item = items[next++]) {
      await handle(item);
    }
  };
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, worker));
}

/**
 * An order PayPal may or may not have. Known by id (PENDING): read it. Otherwise, soon after the
 * decision, send it again with its request id — unless the hold closed or the mandate was
 * revoked meanwhile, since that could start a payment nobody wants any more. Later, search
 * PayPal's records once they have caught up, and fail it only on a definite "not found" a day on.
 */
async function resolveOrder(deps: AppDeps, payment: Payment): Promise<Handled> {
  const receipt = await deps.store.attempts.get(payment.attemptId);
  if (receipt === null) {
    throw new Error(`payment ${payment.attemptId} has no attempt`);
  }
  const now = deps.clock.now();
  const order = operation(payment, "ORDER");
  const age = now.getTime() - order.createdAt.getTime();
  const { config } = deps;

  let after: Payment;
  if (payment.paypalOrderId !== null) {
    const orderId = payment.paypalOrderId;
    const read = await callPayPal(deps, "order read", (signal) =>
      deps.gateway.getOrder(orderId, signal),
    );
    after = await applyStep(deps, payment, afterOrderRead(payment.intent, read), "resolver");
  } else if (age < config.orderResendWindowMs && !holdClosed(receipt)) {
    const vaultId = await deps.store.mandates.vaultIdForCharge(receipt.attempt.mandateId);
    if (vaultId === null) {
      // Revoked since the decision: nothing new goes out. A lookup later finds what PayPal has.
      return "waiting";
    }
    deps.log.info("resolver.order_resent", { attemptId: payment.attemptId });
    after = await sendOrder(deps, payment, {
      vaultId,
      description: orderDescription(receipt, await titleOf(deps, receipt)),
    });
  } else if (age < config.reportingLagMs) {
    return "waiting";
  } else {
    const found = await callPayPal(deps, "order lookup", (signal) =>
      deps.gateway.findOrderByInvoice(
        {
          invoiceId: payment.attemptId,
          amountCents: payment.amountCents,
          from: new Date(order.createdAt.getTime() - LOOKUP_SKEW_MS),
          to: now,
        },
        signal,
      ),
    );
    if (found.kind === "unknown") {
      deps.log.error("resolver.lookup_unanswered", {
        attemptId: payment.attemptId,
        reason: found.reason,
      });
    }
    const step = afterLookup(payment.intent, found, age >= config.orderGiveUpMs);
    after = await applyStep(deps, payment, step, "resolver lookup");
  }
  return ORDER_OPEN.includes(after.status) ? "waiting" : "settled";
}

/**
 * A capture or void of a hold's authorization that did not finish. Soon after it was written,
 * send it again with its request id; later, read the authorization and record what happened.
 * A capture approved before a revoke still completes: the owner approved it while they could.
 */
async function resolveHoldOperation(deps: AppDeps, payment: Payment): Promise<Handled> {
  const kind = payment.status === "CAPTURING" ? "CAPTURE" : "VOID";
  const age = deps.clock.now().getTime() - operation(payment, kind).createdAt.getTime();
  let after: Payment;
  if (age < deps.config.operationResendWindowMs) {
    after = kind === "CAPTURE" ? await sendCapture(deps, payment) : await sendVoid(deps, payment);
  } else {
    after = await applyStep(
      deps,
      payment,
      { kind: "check-authorization", why: `${kind} unsettled after its re-send window` },
      "resolver",
    );
  }
  return OPERATION_OPEN.includes(after.status) ? "waiting" : "settled";
}

function holdClosed(receipt: Receipt): boolean {
  const status = receipt.hold?.status;
  return status === "DECLINED" || status === "EXPIRED";
}

async function titleOf(deps: AppDeps, receipt: Receipt): Promise<string | null> {
  const id = receipt.attempt.decision.checkResult.snapshotId;
  return id === null ? null : ((await deps.store.snapshots.get(id))?.title ?? null);
}
