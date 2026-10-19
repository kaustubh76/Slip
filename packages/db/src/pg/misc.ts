import {
  type AgentReport,
  cents,
  type ImpressionRepo,
  type LeaseRepo,
  NotFoundError,
  type ReportRepo,
  agentId as toAgentId,
  type WebhookRepo,
} from "@slip/domain";
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { attempts, checkoutLeases, payments, searchImpressions, webhookEvents } from "../schema.js";
import { guarded } from "./errors.js";

export function pgWebhooks(db: Db): WebhookRepo {
  return {
    recordOnce: (event) =>
      guarded(async () => {
        const inserted = await db
          .insert(webhookEvents)
          .values({
            id: event.id,
            eventType: event.eventType,
            resourceId: event.resourceId,
            payload: event.payload,
            receivedAt: event.receivedAt,
          })
          .onConflictDoNothing({ target: webhookEvents.id })
          .returning({ id: webhookEvents.id });
        if (inserted.length > 0) {
          return { inserted: true, processedAt: null };
        }
        const [row] = await db
          .select({ processedAt: webhookEvents.processedAt })
          .from(webhookEvents)
          .where(eq(webhookEvents.id, event.id));
        return { inserted: false, processedAt: row?.processedAt ?? null };
      }),

    markProcessed: (id, now) =>
      guarded(async () => {
        const updated = await db
          .update(webhookEvents)
          .set({ processedAt: now })
          .where(and(eq(webhookEvents.id, id), isNull(webhookEvents.processedAt)))
          .returning({ id: webhookEvents.id });
        if (updated.length === 0) {
          const [row] = await db
            .select({ id: webhookEvents.id })
            .from(webhookEvents)
            .where(eq(webhookEvents.id, id));
          if (row === undefined) {
            throw new NotFoundError("webhook event", id);
          }
        }
      }),

    listUnprocessed: (limit) =>
      guarded(async () => {
        const rows = await db
          .select()
          .from(webhookEvents)
          .where(isNull(webhookEvents.processedAt))
          .orderBy(asc(webhookEvents.receivedAt), asc(webhookEvents.id))
          .limit(limit);
        return rows.map((row) => ({
          id: row.id,
          eventType: row.eventType,
          resourceId: row.resourceId,
          payload: row.payload,
          receivedAt: row.receivedAt,
          processedAt: row.processedAt,
        }));
      }),
  };
}

/**
 * What was shown, upserted per (agent, product). The same statement that records a search also
 * forgets this agent's older rows, so nothing has to sweep the table on a schedule.
 */
export function pgImpressions(db: Db): ImpressionRepo {
  return {
    show: (agentId, shown, now, keepSince) =>
      guarded(async () => {
        if (shown.length > 0) {
          await db
            .insert(searchImpressions)
            .values(
              shown.map((row) => ({
                agentId,
                productId: row.productId,
                text: row.text,
                shownAt: now,
              })),
            )
            .onConflictDoUpdate({
              target: [searchImpressions.agentId, searchImpressions.productId],
              set: { text: sql`excluded.text`, shownAt: sql`excluded.shown_at` },
            });
        }
        await db
          .delete(searchImpressions)
          .where(
            and(eq(searchImpressions.agentId, agentId), lt(searchImpressions.shownAt, keepSince)),
          );
      }),

    latest: (agentId, productId) =>
      guarded(async () => {
        const rows = await db
          .select()
          .from(searchImpressions)
          .where(
            and(eq(searchImpressions.agentId, agentId), eq(searchImpressions.productId, productId)),
          )
          .limit(1);
        const row = rows[0];
        return row === undefined
          ? null
          : { agentId, productId: row.productId, text: row.text, shownAt: row.shownAt };
      }),
  };
}

export function pgLeases(db: Db): LeaseRepo {
  return {
    acquire: (key, holder, ttlMs, now) =>
      guarded(async () => {
        const expiresAt = new Date(now.getTime() + ttlMs);
        // Take the lease when free, expired, or already ours (then extend it).
        const rows = await db
          .insert(checkoutLeases)
          .values({ agentId: key.agentId, productId: key.productId, holder, expiresAt })
          .onConflictDoUpdate({
            target: [checkoutLeases.agentId, checkoutLeases.productId],
            set: { holder, expiresAt },
            setWhere: sql`${checkoutLeases.expiresAt} <= ${now.toISOString()}::timestamptz or ${checkoutLeases.holder} = ${holder}`,
          })
          .returning({ holder: checkoutLeases.holder });
        return rows.length === 1 && rows[0]?.holder === holder;
      }),

    release: (key, holder) =>
      guarded(async () => {
        await db
          .delete(checkoutLeases)
          .where(
            and(
              eq(checkoutLeases.agentId, key.agentId),
              eq(checkoutLeases.productId, key.productId),
              eq(checkoutLeases.holder, holder),
            ),
          );
      }),
  };
}

export function pgReports(db: Db): ReportRepo {
  return {
    agentReport: (agentId) =>
      guarded(async () => {
        const own = sql`${attempts.origin} = 'AGENT'`;
        const overpaid = sql`${own} and ${attempts.gapAbsCents} > 0`;
        const [row] = await db
          .select({
            attempted: sql<number>`count(*) filter (where ${own})`.mapWith(Number),
            paid: sql<number>`count(*) filter (where ${own} and ${attempts.outcome} = 'PAID')`.mapWith(
              Number,
            ),
            rejected:
              sql<number>`count(*) filter (where ${own} and ${attempts.outcome} = 'REJECTED')`.mapWith(
                Number,
              ),
            held: sql<number>`count(*) filter (where ${own} and ${attempts.outcome} = 'HELD')`.mapWith(
              Number,
            ),
            notCheapest: sql<number>`count(*) filter (where ${overpaid})`.mapWith(Number),
            median: sql<
              number | null
            >`percentile_disc(0.5) within group (order by ${attempts.gapPctHundredths}) filter (where ${overpaid})`,
            worstPct: sql<
              number | null
            >`max(${attempts.gapPctHundredths}) filter (where ${overpaid})`,
            worstAbs: sql<number | null>`max(${attempts.gapAbsCents}) filter (where ${overpaid})`,
            steered: sql<number>`count(*) filter (where ${own} and ${attempts.steered})`.mapWith(
              Number,
            ),
            conflicts: sql<number>`count(*) filter (where ${own} and ${attempts.conflict})`.mapWith(
              Number,
            ),
          })
          .from(attempts)
          .where(eq(attempts.agentId, agentId));
        const [captured] = await db
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(payments)
          .where(and(eq(payments.agentId, agentId), eq(payments.status, "CAPTURED")));
        const num = (value: unknown): number | null =>
          value === null || value === undefined ? null : Number(value);
        const worstAbs = num(row?.worstAbs);
        const report: AgentReport = {
          agentId: toAgentId(agentId),
          attempted: row?.attempted ?? 0,
          paid: row?.paid ?? 0,
          rejected: row?.rejected ?? 0,
          held: row?.held ?? 0,
          captured: captured?.n ?? 0,
          notCheapest: row?.notCheapest ?? 0,
          medianGapPctHundredths: num(row?.median),
          worstGapPctHundredths: num(row?.worstPct),
          worstGapAbsCents: worstAbs === null ? null : cents(worstAbs),
          steered: row?.steered ?? 0,
          conflicts: row?.conflicts ?? 0,
        };
        return report;
      }),
  };
}
