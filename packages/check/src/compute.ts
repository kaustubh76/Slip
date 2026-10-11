import { type Cents, cents, gapPctHundredthsFloor, type Offer } from "@slip/domain";
import type { ComparableOffer } from "./comparable.js";

/**
 * Total order used to pick the best offer: lowest price, then lowest commission (unknown last),
 * then URL. Deterministic, so the result cannot depend on the order Channel3 returned offers in,
 * and a tie at the lowest price resolves to the lower-commission store (D8).
 */
export function compareOffers(a: ComparableOffer, b: ComparableOffer): number {
  if (a.priceCents !== b.priceCents) {
    return a.priceCents - b.priceCents;
  }
  const aBps = a.commissionBps ?? Number.POSITIVE_INFINITY;
  const bBps = b.commissionBps ?? Number.POSITIVE_INFINITY;
  if (aBps !== bBps) {
    return aBps < bBps ? -1 : 1;
  }
  if (a.url !== b.url) {
    return a.url < b.url ? -1 : 1;
  }
  return 0;
}

export function pickBest(comparable: readonly ComparableOffer[]): ComparableOffer | null {
  let best: ComparableOffer | null = null;
  for (const offer of comparable) {
    if (best === null || compareOffers(offer, best) < 0) {
      best = offer;
    }
  }
  return best;
}

export interface Gap {
  gapAbsCents: Cents;
  /** floor(gap / best · 10 000); for display only. */
  gapPctHundredths: number;
}

/** Throws if the chosen offer is cheaper than the best: the caller broke the invariant (D5). */
export function computeGap(chosen: ComparableOffer, best: ComparableOffer): Gap {
  const gapAbsCents = cents(chosen.priceCents - best.priceCents);
  return {
    gapAbsCents,
    gapPctHundredths: gapPctHundredthsFloor(gapAbsCents, best.priceCents),
  };
}

/**
 * The pricier store pays the agent's platform more commission than the cheaper one. Both rates
 * must be known and above zero: Channel3 reports 0 when it has no data (D3).
 */
export function hasConflict(chosen: Offer, best: Offer, gapAbsCents: Cents): boolean {
  return (
    gapAbsCents > 0 &&
    chosen.commissionBps !== null &&
    best.commissionBps !== null &&
    chosen.commissionBps > 0 &&
    best.commissionBps > 0 &&
    chosen.commissionBps > best.commissionBps
  );
}
