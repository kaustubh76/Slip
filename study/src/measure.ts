import { comparableOffers } from "@slip/check";
import {
  type Cents,
  cents,
  gapPctHundredthsFloor,
  lowerMedian,
  type Offer,
  type ProductOffers,
} from "@slip/domain";
import type { Fetch } from "@slip/http";
import { createChannel3Offers } from "@slip/offers";
import type { Snapshot } from "./snapshots.js";

/**
 * The three numbers §6.1 asks for, measured the way Slip measures.
 *
 * Two rules keep this honest. Every product goes through **the production adapter** — the snapshot
 * is served to `createChannel3Offers` through an injected `fetch` — so an offer the adapter would
 * drop is dropped here too; the study cannot report offers Slip could not have compared. And
 * "comparable" is `@slip/check`'s own `comparableOffers`: in stock, condition new, a positive USD
 * price, deduplicated by normalised URL. A looser definition would inflate every number here.
 */

export interface Spread {
  cheapest: Cents;
  priciest: Cents;
  gapCents: Cents;
  /** Of the cheapest price, as the rules measure a gap. */
  gapPctHundredths: number;
}

export interface ProductMeasure {
  productId: string;
  title: string;
  /** The query whose results first carried this product. */
  foundBy: string;
  /** Offers the adapter produced, and how many of those could be compared. */
  offers: number;
  comparable: number;
  /** Cheapest against priciest, when there are two or more comparable offers. */
  spread: Spread | null;
  /** How many comparable offers stated a commission rate, and whether the top payer is dearer. */
  commissionKnown: number;
  topCommissionIsDearer: boolean | null;
  domains: string[];
}

export interface StudyNumbers {
  products: number;
  /** Products with at least one comparable offer: the rest cannot be checked at all. */
  priced: number;
  withTwoOrMore: number;
  /** Share of the whole sample with two or more comparable offers, in hundredths of a percent. */
  shareWithTwoOrMorePctHundredths: number;
  /** G1 asks for 60 % or better. */
  g1Pass: boolean;
  medianGapPctHundredths: number | null;
  medianGapCents: Cents | null;
  widestGapPctHundredths: number | null;
  /** Products where commission could be compared, and where the dearer offer pays more. */
  commissionConsidered: number;
  commissionConflicts: number;
  commissionConflictPctHundredths: number | null;
}

/** G1's bar: at least this share of sampled products must carry two or more comparable offers. */
export const G1_SHARE_PCT_HUNDREDTHS = 6_000;

/**
 * Every product in the sample, each counted once. A product found by two queries is one product;
 * the first query to return it is recorded, so the count cannot be inflated by overlap.
 */
export function productsFrom(snapshots: readonly Snapshot[]): { foundBy: string; raw: unknown }[] {
  const seen = new Set<string>();
  const products: { foundBy: string; raw: unknown }[] = [];
  for (const snapshot of snapshots) {
    const body = snapshot.body as { products?: unknown } | null;
    const list = Array.isArray(body?.products) ? body.products : [];
    for (const raw of list) {
      const id = (raw as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || id === "" || seen.has(id)) {
        continue;
      }
      seen.add(id);
      products.push({ foundBy: snapshot.slug, raw });
    }
  }
  return products;
}

/** Maps one recorded product exactly as the adapter would, or null if the adapter would reject it. */
export async function mapAsSlipWould(raw: unknown): Promise<ProductOffers | null> {
  const id = (raw as { id?: unknown } | null)?.id;
  if (typeof id !== "string") {
    return null;
  }
  const served = (async () =>
    new Response(JSON.stringify(raw), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as Fetch;
  const source = createChannel3Offers({ apiKey: "offline-study", fetch: served });
  const result = await source.fetchProduct(id, new AbortController().signal);
  return result.ok ? result.product : null;
}

export async function measureProducts(snapshots: readonly Snapshot[]): Promise<ProductMeasure[]> {
  const measures: ProductMeasure[] = [];
  for (const { foundBy, raw } of productsFrom(snapshots)) {
    const product = await mapAsSlipWould(raw);
    if (product === null) {
      continue;
    }
    measures.push(measureOne(product, foundBy));
  }
  return measures;
}

export function measureOne(product: ProductOffers, foundBy: string): ProductMeasure {
  const comparable = comparableOffers(product.offers);
  const prices = comparable.map((offer) => offer.priceCents);
  const cheapest = prices.length === 0 ? null : (Math.min(...prices) as Cents);
  const priciest = prices.length === 0 ? null : (Math.max(...prices) as Cents);
  const spread =
    comparable.length >= 2 && cheapest !== null && priciest !== null
      ? {
          cheapest,
          priciest,
          gapCents: cents(priciest - cheapest),
          gapPctHundredths: gapPctHundredthsFloor(cents(priciest - cheapest), cheapest),
        }
      : null;
  const withCommission = comparable.filter((offer) => offer.commissionBps !== null);
  return {
    productId: product.productId,
    title: product.title,
    foundBy,
    offers: product.offers.length,
    comparable: comparable.length,
    spread,
    commissionKnown: withCommission.length,
    topCommissionIsDearer: topPaysMore(withCommission),
    domains: comparable.map((offer) => offer.domain),
  };
}

/**
 * Whether the offer paying the most commission is dearer than the cheapest comparable one — the
 * conflict the check looks for. Null when fewer than two offers state a rate, or when every rate
 * is the same: there is no conflict to find in either case, and counting them would dilute the
 * number with products that could never have shown one.
 */
function topPaysMore(offers: readonly (Offer & { priceCents: Cents })[]): boolean | null {
  if (offers.length < 2) {
    return null;
  }
  const rates = offers.map((offer) => offer.commissionBps ?? 0);
  const top = Math.max(...rates);
  if (top === Math.min(...rates)) {
    return null;
  }
  const cheapest = Math.min(...offers.map((offer) => offer.priceCents));
  // Every offer at the top rate: if any of them is the cheapest, the agent's incentive aligns.
  const topPayers = offers.filter((offer) => (offer.commissionBps ?? 0) === top);
  return !topPayers.some((offer) => offer.priceCents === cheapest);
}

export function summarise(measures: readonly ProductMeasure[]): StudyNumbers {
  const products = measures.length;
  const priced = measures.filter((m) => m.comparable >= 1).length;
  const spreads = measures.map((m) => m.spread).filter((s): s is Spread => s !== null);
  const considered = measures.filter((m) => m.topCommissionIsDearer !== null);
  const conflicts = considered.filter((m) => m.topCommissionIsDearer === true).length;
  const share = products === 0 ? 0 : Math.round((spreads.length / products) * 10_000);
  const medianCents = lowerMedian(spreads.map((s) => s.gapCents));
  return {
    products,
    priced,
    withTwoOrMore: spreads.length,
    shareWithTwoOrMorePctHundredths: share,
    g1Pass: share >= G1_SHARE_PCT_HUNDREDTHS,
    medianGapPctHundredths: lowerMedian(spreads.map((s) => s.gapPctHundredths)),
    medianGapCents: medianCents === null ? null : cents(medianCents),
    widestGapPctHundredths:
      spreads.length === 0 ? null : Math.max(...spreads.map((s) => s.gapPctHundredths)),
    commissionConsidered: considered.length,
    commissionConflicts: conflicts,
    commissionConflictPctHundredths:
      considered.length === 0 ? null : Math.round((conflicts / considered.length) * 10_000),
  };
}
