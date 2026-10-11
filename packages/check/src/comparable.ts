import type { Cents, Offer } from "@slip/domain";
import { normalizeOfferUrl } from "./url.js";

/** An offer that can take part in the price comparison: it has a positive USD price. */
export type ComparableOffer = Offer & { priceCents: Cents };

/** Keeps the first offer of each normalised URL; a listing that appears twice counts once. */
export function dedupeByNormalizedUrl(offers: readonly Offer[]): Offer[] {
  const seen = new Set<string>();
  const unique: Offer[] = [];
  for (const offer of offers) {
    const key = normalizeOfferUrl(offer.url) ?? offer.url;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(offer);
  }
  return unique;
}

/** Same product id and variant is guaranteed by the snapshot; this checks the rest. */
export function isComparable(offer: Offer): offer is ComparableOffer {
  return (
    offer.priceCents !== null &&
    offer.currency === "USD" &&
    offer.availability === "InStock" &&
    offer.condition === "new"
  );
}

export function comparableOffers(offers: readonly Offer[]): ComparableOffer[] {
  return dedupeByNormalizedUrl(offers).filter(isComparable);
}
