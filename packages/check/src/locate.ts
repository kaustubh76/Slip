import type { Offer } from "@slip/domain";
import { domainOf, normalizeDomain, normalizeOfferUrl } from "./url.js";

export type MatchedBy = "url" | "normalized" | "domain";

export interface Located {
  offer: Offer;
  matchedBy: MatchedBy;
}

/**
 * The domain an offer is sold on — the catalogue's own `domain` field first, and the url's host
 * only when there is none.
 *
 * That order matters because a url's host is not always a store: Channel3's offer urls are
 * redirects through `buy.trychannel3.com`, so every offer for a product would share one host and
 * the domain fallback below could never tell them apart. The `domain` field is the merchant.
 */
export function offerDomain(offer: Offer): string {
  const stated = normalizeDomain(offer.domain);
  return stated === "" ? (domainOf(offer.url) ?? "") : stated;
}

/**
 * Finds the offer the agent chose, trying the exact URL, then the normalised URL, then the
 * domain — but a domain match counts only when exactly one offer is sold there. Anything
 * ambiguous is "not found": the server never guesses which listing to pay for.
 */
export function locateChosen(offers: readonly Offer[], chosenOfferUrl: string): Located | null {
  const exact = offers.find((offer) => offer.url === chosenOfferUrl);
  if (exact !== undefined) {
    return { offer: exact, matchedBy: "url" };
  }

  const target = normalizeOfferUrl(chosenOfferUrl);
  if (target !== null) {
    const normalized = offers.find((offer) => normalizeOfferUrl(offer.url) === target);
    if (normalized !== undefined) {
      return { offer: normalized, matchedBy: "normalized" };
    }
  }

  const domain = domainOf(chosenOfferUrl);
  if (domain !== null) {
    const onDomain = offers.filter((offer) => offerDomain(offer) === domain);
    const [only] = onDomain;
    if (onDomain.length === 1 && only !== undefined) {
      return { offer: only, matchedBy: "domain" };
    }
  }

  return null;
}
