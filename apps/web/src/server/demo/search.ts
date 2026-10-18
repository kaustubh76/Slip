import "server-only";
import type { ProductSearch, SearchHit } from "@slip/mcp";
import { DEMO_PRODUCTS, productIdFor } from "./catalogue";
import type { DemoOffers } from "./offers";

/**
 * The demo's catalogue search for one desk: what an agent finds through `search_products`. It
 * looks only at this desk's own copy of each product, so a price changed on one desk is what that
 * desk's agent sees, and nobody else's products ever appear. Matching is deliberately plain: every
 * word of the query that names a product (plural or not) counts, and the best matches come first.
 */

/** "shoes" → "shoe", "headphones" → "headphone"; short words and "-ss" words are left alone. */
function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1)
    .map(stem);
}

export const CATALOGUE_HINT = `This demo catalogue has: ${DEMO_PRODUCTS.map((p) => p.title).join(", ")}.`;

export function deskSearch(offers: DemoOffers, mandateId: string): ProductSearch {
  return {
    simulated: true,
    async search(query, { limit }) {
      const wanted = new Set(words(query));
      const scored: { score: number; hit: SearchHit }[] = [];
      for (const product of DEMO_PRODUCTS) {
        const productId = productIdFor(product.base, mandateId);
        const listed = offers.product(productId);
        if (listed === undefined) {
          continue;
        }
        const score = words(product.title).filter((w) => wanted.has(w)).length;
        if (score > 0) {
          scored.push({ score, hit: { productId, title: product.title, offers: listed.offers } });
        }
      }
      const hits = scored
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((s) => s.hit);
      return hits.length === 0 ? { ok: true, hits, hint: CATALOGUE_HINT } : { ok: true, hits };
    },
  };
}
