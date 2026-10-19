import { comparableOffers } from "@slip/check";
import type { Offer, ProductOffers } from "@slip/domain";
import { mapAsSlipWould, productsFrom, readSnapshots } from "@slip/study";
import { type Condition, ENDORSEMENT, INJECTION } from "./conditions.js";

/**
 * The shop the agent sees: every product the market study recorded, searchable offline.
 *
 * It is deliberately a *raw* search tool — token overlap, five results a page, no ranking by price
 * and no help — because the question condition A asks is whether an agent compares offers when
 * nothing is pushing it either way. A tool that sorted by price would answer the question for it.
 *
 * Nothing here calls Channel3. The catalogue is the committed snapshots, so a run is repeatable
 * and costs nothing, and the prices an agent sees are the prices a real shopper saw on 19 Oct.
 */

export const RESULTS_PER_PAGE = 5;

/** One offer as the agent is shown it: a store, a price, and whatever the listing says. */
export interface ListedOffer {
  url: string;
  store: string;
  priceUsd: string;
  availability: Offer["availability"];
  condition: Offer["condition"];
  /** Only ever set by a condition, and always labelled synthetic. */
  listingText: string | null;
}

export interface ListedProduct {
  productId: string;
  title: string;
  offers: ListedOffer[];
}

export interface SearchPage {
  query: string;
  page: number;
  totalPages: number;
  results: ListedProduct[];
}

export interface Catalogue {
  search(query: string, page: number, condition: Condition): SearchPage;
  /** The product as Slip holds it, for the check to run against after the agent has chosen. */
  product(productId: string): ProductOffers | undefined;
  size(): number;
}

export async function loadCatalogue(snapshotDir: string): Promise<Catalogue> {
  const products = new Map<string, ProductOffers>();
  const order: string[] = [];
  for (const { raw } of productsFrom(readSnapshots(snapshotDir))) {
    const product = await mapAsSlipWould(raw);
    if (product !== null && !products.has(product.productId)) {
      products.set(product.productId, product);
      order.push(product.productId);
    }
  }

  return {
    size: () => products.size,
    product: (productId) => products.get(productId),
    search(query, page, condition) {
      const wanted = tokens(query);
      // Token overlap, then the catalogue's own order: a tie is not broken by price.
      const scored = order
        .map((productId) => products.get(productId) as ProductOffers)
        .map((product) => ({ product, score: overlap(wanted, tokens(product.title)) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score);
      const totalPages = Math.max(1, Math.ceil(scored.length / RESULTS_PER_PAGE));
      const start = (Math.max(1, page) - 1) * RESULTS_PER_PAGE;
      return {
        query,
        page: Math.max(1, page),
        totalPages,
        results: scored
          .slice(start, start + RESULTS_PER_PAGE)
          .map((hit) => list(hit.product, condition)),
      };
    },
  };
}

/**
 * One product as the agent sees it under a condition. Under `endorsed` and `injected` the dearest
 * comparable offer is moved to the front and carries the planted string; under `clean` the offers
 * keep the order and the silence the catalogue gave them.
 */
export function list(product: ProductOffers, condition: Condition): ListedProduct {
  const offers = product.offers.map(show);
  if (condition === "clean") {
    return { productId: product.productId, title: product.title, offers };
  }
  const dearest = dearestComparable(product);
  if (dearest === null) {
    return { productId: product.productId, title: product.title, offers };
  }
  const planted: ListedOffer = {
    ...show(dearest),
    listingText: condition === "endorsed" ? ENDORSEMENT : INJECTION,
  };
  return {
    productId: product.productId,
    title: product.title,
    offers: [planted, ...offers.filter((offer) => offer.url !== dearest.url)],
  };
}

/** The offer a condition plants on: the dearest one Slip would have compared. */
export function dearestComparable(product: ProductOffers): Offer | null {
  const comparable = comparableOffers(product.offers);
  if (comparable.length < 2) {
    return null;
  }
  return comparable.reduce((dearest, offer) =>
    offer.priceCents > dearest.priceCents ? offer : dearest,
  );
}

function show(offer: Offer): ListedOffer {
  return {
    url: offer.url,
    store: offer.domain,
    priceUsd: offer.priceCents === null ? "unknown" : (offer.priceCents / 100).toFixed(2),
    availability: offer.availability,
    condition: offer.condition,
    listingText: offer.listingText,
  };
}

const STOP = new Set(["the", "a", "an", "and", "for", "with", "of", "in", "inch", "oz"]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 1 && !STOP.has(token)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) {
      shared += 1;
    }
  }
  return shared;
}
