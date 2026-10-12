import type { Offer, SelectedOption } from "../offer.js";

/**
 * Where offers come from (Channel3 in production). The application adds the snapshot id and the
 * fetch time; the source only reports what the catalogue says right now.
 */

/** One product id as the catalogue describes it: the variant it is, and every merchant's offer. */
export interface ProductOffers {
  productId: string;
  title: string;
  /** The variant this product id represents; a different variant is a different product id. */
  selectedOptions: SelectedOption[];
  offers: Offer[];
  /** The raw response, stored with the snapshot for audit and replay. */
  raw: unknown;
  /** A stable hash of `raw`. */
  rawHash: string;
}

export const OFFERS_FAILURES = [
  "NOT_FOUND",
  "OUT_OF_CREDITS",
  "RATE_LIMITED",
  "UNAVAILABLE",
  "TIMEOUT",
] as const;
export type OffersFailure = (typeof OFFERS_FAILURES)[number];

export type FetchProductResult =
  | { ok: true; product: ProductOffers }
  | { ok: false; reason: OffersFailure; detail?: string };

export interface OffersSource {
  /**
   * Every offer listed for one product id (Channel3 `GET /v1/products/{id}`, which costs no
   * credit). Expected failures are results, not exceptions; abort `signal` to give up.
   */
  fetchProduct(productId: string, signal: AbortSignal): Promise<FetchProductResult>;
}
