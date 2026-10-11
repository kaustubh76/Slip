import type { OfferSnapshot, Policy } from "@slip/domain";

/** Milliseconds between the snapshot's fetch time and `now`. Negative when the clock ran back. */
export function snapshotAgeMs(snapshot: OfferSnapshot, now: Date): number {
  return now.getTime() - snapshot.fetchedAt.getTime();
}

/**
 * The one definition of "fresh": age at most `policy.snapshotMaxAgeMs`. The orchestrator uses it
 * to decide whether to refetch; rule R1 uses it to hold when a refetch was not possible. A
 * snapshot from the future counts as fresh.
 */
export function isSnapshotFresh(snapshot: OfferSnapshot, policy: Policy, now: Date): boolean {
  return snapshotAgeMs(snapshot, now) <= policy.snapshotMaxAgeMs;
}
