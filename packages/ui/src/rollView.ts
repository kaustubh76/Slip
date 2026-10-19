import type { Outcome } from "@slip/domain";
import type { AgentCard, ReceiptRow } from "@slip/receipt";
import { utcDay } from "@slip/receipt";

/**
 * What the roll shows about itself. Two kinds of number live here and they must not be mistaken
 * for one another:
 *
 * - **Totals** come from the agents' report cards, which the server counts over every attempt
 *   ever recorded. They are the truth about the desk.
 * - **Counts of what is loaded** describe the rows on the roll right now, which is the newest few
 *   pages and nothing older. They are what a filter narrows, and they are labelled as such.
 *
 * Nothing here adds money up: no total of what was spent exists anywhere in Slip, and inventing
 * one from the rows that happen to be loaded would be a claim Slip cannot stand behind.
 */

export interface RollTotals {
  agents: number;
  attempted: number;
  paid: number;
  rejected: number;
  held: number;
  /** Payments that reached PayPal and completed. */
  captured: number;
  /** Purchases whose chosen offer was not the cheapest comparable one. */
  notCheapest: number;
  /** Listings that carried text written to steer an agent. */
  steered: number;
}

/** The desk's totals: every agent's report card added up. */
export function summariseAgents(cards: readonly AgentCard[]): RollTotals {
  const totals: RollTotals = {
    agents: cards.length,
    attempted: 0,
    paid: 0,
    rejected: 0,
    held: 0,
    captured: 0,
    notCheapest: 0,
    steered: 0,
  };
  for (const card of cards) {
    const report = card.report.report;
    totals.attempted += report.attempted;
    totals.paid += report.paid;
    totals.rejected += report.rejected;
    totals.held += report.held;
    totals.captured += report.captured;
    totals.notCheapest += report.notCheapest;
    totals.steered += report.steered;
  }
  return totals;
}

export type OutcomeCounts = Readonly<Record<Outcome, number>>;

/** How many of the loaded rows ended each way. */
export function countByOutcome(rows: readonly ReceiptRow[]): OutcomeCounts {
  const counts = { PAID: 0, REJECTED: 0, HELD: 0 };
  for (const row of rows) {
    counts[row.view.outcome] += 1;
  }
  return counts;
}

/** The loaded rows an owner asked to see; `null` keeps all of them. */
export function filterRows(
  rows: readonly ReceiptRow[],
  outcome: Outcome | null,
): readonly ReceiptRow[] {
  return outcome === null ? rows : rows.filter((row) => row.view.outcome === outcome);
}

/** The day a receipt belongs to, in UTC, as the roll labels it. */
export function dayOf(row: ReceiptRow): string {
  return utcDay(new Date(row.view.createdAt));
}

/** Where the day changes going down the roll, so a separator can be drawn before those rows. */
export function dayStarts(rows: readonly ReceiptRow[]): ReadonlyMap<string, string> {
  const starts = new Map<string, string>();
  let last: string | null = null;
  for (const row of rows) {
    const day = dayOf(row);
    if (day !== last) {
      starts.set(row.view.receiptId, day);
      last = day;
    }
  }
  return starts;
}
