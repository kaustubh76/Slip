import { comparableOffers, normalizeOfferUrl } from "@slip/check";
import { type Cents, formatUsd, type OfferSnapshot, type Policy, type Receipt } from "@slip/domain";
import type { Measure } from "./schema.js";

/**
 * The gap scale: one line from the lowest listed price to the agent's choice, with the stretch
 * "within your limits" marked. Positions are integers on a 0–1000 scale, so any client draws it
 * the same way. Drawn only when the check compared prices and the owner's limits are known.
 *
 * Within your limits runs up to the lowest price plus the larger of the two allowances, because
 * rule R4 rejects only when the gap exceeds both the percent and the dollar limit.
 */

export const MEASURE_WIDTH = 1000;

/** Sums of cents are still cents. */
const usd = (cents: number): string => formatUsd(cents as Cents);

export function measureModel(
  receipt: Receipt,
  policy: Policy | undefined,
  snapshot: OfferSnapshot | null,
): Measure | null {
  const result = receipt.attempt.decision.checkResult;
  const best = result.best?.priceCents ?? null;
  const chosen = result.chosen?.priceCents ?? null;
  if (policy === undefined || result.gapAbsCents === null || best === null || chosen === null) {
    return null;
  }
  const allowance = Math.max(
    Math.floor((best * policy.maxOverpayPctHundredths) / 10_000),
    policy.maxOverpayAbsCents,
  );
  const limit = best + allowance;
  const cap = result.ruleCodes.includes("R6_ABOVE_ORDER_CAP") ? policy.orderCapCents : null;
  const skip = new Set(
    [result.chosen?.url, result.best?.url].map((url) => (url && normalizeOfferUrl(url)) || url),
  );
  const ticks =
    snapshot === null
      ? []
      : comparableOffers(snapshot.offers)
          .filter((o) => !skip.has(normalizeOfferUrl(o.url) ?? o.url))
          .map((o) => o.priceCents);

  const low = Math.min(best, cap ?? best);
  const high = Math.max(chosen, limit, ...ticks);
  // A little room past the rightmost mark, so it is not drawn on the edge.
  const span = Math.max(1, high - low) * 1.06;
  const x = (cents: number) => Math.round(((cents - low) / span) * MEASURE_WIDTH);
  const mark = (cents: number) => ({ cents, x: x(cents), label: usd(cents) });

  const past = chosen > limit ? chosen - limit : null;
  const pastLimit = past === null ? null : `+${usd(past)} past your limit`;
  const caption = [
    `Lowest listed price ${usd(best)}.`,
    `Within your limits up to ${usd(limit)}.`,
    past === null
      ? `Your agent's choice, ${usd(chosen)}, is within them.`
      : `Your agent's choice, ${usd(chosen)}, is ${usd(past)} past your limit.`,
    ...(cap === null ? [] : [`Your order cap is ${usd(cap)}.`]),
    ...(ticks.length === 0
      ? []
      : [`${ticks.length} other comparable ${ticks.length === 1 ? "offer" : "offers"} listed.`]),
  ].join(" ");

  return {
    width: MEASURE_WIDTH,
    low: mark(best),
    limit: mark(limit),
    chosen: mark(chosen),
    cap: cap === null ? null : mark(cap),
    ticks: ticks.map((cents) => ({ cents, x: x(cents) })),
    pastLimit,
    caption,
  };
}
