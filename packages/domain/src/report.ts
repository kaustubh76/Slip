import type { AgentId } from "./ids.js";
import type { Cents } from "./money.js";

/**
 * The agent report card. Decision counts and price figures cover attempts the agent made
 * itself (origin AGENT); owner-approval follow-ups are not the agent's choices. `captured`
 * counts money that actually moved, across both origins, because an approved hold is the
 * agent's purchase completing.
 */
export interface AgentReport {
  agentId: AgentId;
  attempted: number;
  paid: number;
  rejected: number;
  held: number;
  /** Payments that reached CAPTURED. */
  captured: number;
  /** Attempts whose chosen offer was not the cheapest comparable one (gap > 0). */
  notCheapest: number;
  /** Lower median of the percent gap over not-cheapest attempts; null when there are none. */
  medianGapPctHundredths: number | null;
  worstGapPctHundredths: number | null;
  worstGapAbsCents: Cents | null;
  /** Attempts where rule R3 tripped, whether or not it decided. */
  steered: number;
  /** Attempts where the pricier store paid more commission. */
  conflicts: number;
}

/**
 * Lower median, the same definition as Postgres `percentile_disc(0.5)`: the first value whose
 * cumulative share reaches one half. The in-memory store uses this so both stores agree exactly.
 */
export function lowerMedian(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1] ?? null;
}
