import { isComparable, normalizeOfferUrl } from "@slip/check";
import {
  type CheckResult,
  formatPct,
  formatUsd,
  type Offer,
  type OfferSnapshot,
} from "@slip/domain";
import type { OfferRow } from "./schema.js";
import { storeName } from "./store-name.js";

/**
 * Every offer the snapshot listed, as the table behind the receipt shows it: which was the lowest
 * comparable price, which the agent chose, and — for each one left out — why, in the words the
 * check itself would use. The reasons follow \`isComparable\` in \`@slip/check\`; a test holds the
 * number of compared rows to the check's own \`comparableCount\`.
 */
export function offerRows(snapshot: OfferSnapshot | null, result: CheckResult): OfferRow[] {
  if (snapshot === null) {
    return [];
  }
  const key = (url: string) => normalizeOfferUrl(url) ?? url;
  const chosen = result.chosen === null ? null : key(result.chosen.url);
  const best = result.best === null ? null : key(result.best.url);
  // R1 stops before anything is compared: the listing was too old to trust.
  const stale = result.ruleCode === "R1_STALE_SNAPSHOT";
  const seen = new Set<string>();
  return snapshot.offers.map((offer) => {
    const id = key(offer.url);
    const repeat = seen.has(id);
    seen.add(id);
    const notCompared = stale ? "prices too old" : repeat ? "listed twice" : whyNot(offer);
    return {
      store: storeName(offer.domain),
      domain: offer.domain,
      link: httpOnly(offer.url),
      price: offer.priceCents === null ? null : formatUsd(offer.priceCents),
      priceCents: offer.priceCents,
      currency: offer.currency,
      inStock: offer.availability === "InStock",
      condition: offer.condition ?? "not stated",
      commission:
        offer.commissionBps !== null && offer.commissionBps > 0
          ? formatPct(offer.commissionBps)
          : null,
      best: !repeat && best !== null && id === best,
      chosen: !repeat && chosen !== null && id === chosen,
      compared: notCompared === null,
      notCompared,
    };
  });
}

function whyNot(offer: Offer): OfferRow["notCompared"] {
  if (isComparable(offer)) {
    return null;
  }
  if (offer.availability !== "InStock") {
    return "out of stock";
  }
  if (offer.condition === "used") {
    return "used";
  }
  if (offer.condition === null) {
    return "condition not stated";
  }
  if (offer.priceCents === null) {
    return "price unknown";
  }
  return "other currency";
}

function httpOnly(url: string): string | null {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
