import "server-only";
import { percentFromHundredths, storeName } from "@slip/receipt";
import { ERRAND_NAMES, ERRANDS, productIdFor } from "./catalogue";
import type { DemoOffers } from "./offers";

/**
 * What the demo agent script reads before it shops: this desk's errands, each with the listing the
 * agent "searched" — the stand-in Channel3's offers for this desk's own copy of the product. A real
 * agent would search Channel3 itself; the demo's agent has nowhere else to look.
 *
 * Synthetic labels stay in the listing text exactly as the catalogue marks them ("[synthetic] Top
 * pick"), so a transcript never passes one off as real.
 */

export interface ListedOffer {
  store: string;
  url: string;
  priceCents: number | null;
  currency: string;
  availability: string;
  /** "new" or "used"; null when the listing does not say. */
  condition: string | null;
  /** "up to 8%", or null when the store pays the agent's platform nothing. */
  commission: string | null;
  listingText: string | null;
}

export interface ErrandListing {
  name: string;
  label: string;
  productId: string;
  title: string;
  chosenUrl: string;
  reason: string;
  /**
   * The errand needs Channel3 down for this product while it runs, which only the console can
   * arrange; the script points there instead of buying.
   */
  consoleOnly: boolean;
  offers: ListedOffer[];
}

export function errandsFor(mandateId: string, offers: DemoOffers): ErrandListing[] {
  return ERRAND_NAMES.map((name) => {
    const errand = ERRANDS[name];
    const productId = productIdFor(errand.product, mandateId);
    const product = offers.product(productId);
    return {
      name,
      label: errand.label,
      productId,
      title: product?.title ?? errand.product,
      chosenUrl: errand.chosenUrl,
      reason: errand.reason,
      consoleOnly: errand.offline === true,
      offers: (product?.offers ?? []).map((o) => ({
        store: storeName(o.domain),
        url: o.url,
        priceCents: o.priceCents,
        currency: o.currency,
        availability: o.availability,
        condition: o.condition,
        commission:
          o.commissionBps !== null && o.commissionBps > 0
            ? `up to ${percentFromHundredths(o.commissionBps)}`
            : null,
        listingText: o.listingText,
      })),
    };
  });
}
