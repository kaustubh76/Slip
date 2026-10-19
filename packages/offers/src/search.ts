import type { Offer } from "@slip/domain";
import { createJsonClient, type Fetch, type JsonClient } from "@slip/http";
import { z } from "zod";
import { CHANNEL3_BASE_URL, channel3Offer, ProductSchema } from "./channel3.js";

/**
 * Channel3's search: `POST /v1/search`, which **costs a credit** where product detail is free.
 *
 * It is a separate entry point (`@slip/offers/search`) rather than part of the adapter, so
 * "`OffersSource` never searches" stays true of the adapter itself — a checkout prices from
 * `fetchProduct` and nothing it does can spend a credit. Only code that means to pay for a search
 * imports this: the owner UI, when it offers an agent a catalogue, and the market study.
 *
 * What the caller does about the cost — caching it, budgeting it — is the caller's, because the
 * limits differ between a web deployment serving many agents and a study taking one sample.
 */

export interface SearchResult {
  /** The whole response, kept verbatim for the snapshot. */
  body: unknown;
  /** Products as Channel3 returned them, unmapped. */
  products: unknown[];
}

export type SearchOutcome =
  | { ok: true; result: SearchResult }
  | { ok: false; status: number | null; detail: string };

export interface Channel3Search {
  search(query: string, limit: number, signal: AbortSignal): Promise<SearchOutcome>;
}

export function createChannel3Search(options: {
  apiKey: string;
  baseUrl?: string;
  fetch?: Fetch;
  client?: JsonClient;
}): Channel3Search {
  const base = (options.baseUrl ?? CHANNEL3_BASE_URL).replace(/\/+$/, "");
  const client =
    options.client ??
    createJsonClient({
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      headers: { "x-api-key": options.apiKey },
    });

  return {
    async search(query, limit, signal): Promise<SearchOutcome> {
      const answer = await client.send({
        url: `${base}/v1/search`,
        method: "POST",
        body: { query, limit },
        signal,
      });
      if (answer.outcome !== "reply") {
        return {
          ok: false,
          status: null,
          detail: answer.outcome === "aborted" ? "the deadline passed" : answer.detail,
        };
      }
      if (answer.status !== 200) {
        // 402 is the one that stops a sample: the credits are gone and nothing more will come.
        return { ok: false, status: answer.status, detail: `Channel3 answered ${answer.status}` };
      }
      const products = (answer.body as { products?: unknown } | null)?.products;
      return Array.isArray(products)
        ? { ok: true, result: { body: answer.body, products } }
        : { ok: false, status: answer.status, detail: "Channel3's answer carried no products" };
    },
  };
}

/** The product's own words, which is where any text an agent reads actually lives (D67). */
const PRODUCT_TEXT_LIMIT = 2_000;

/**
 * One product from a search, as a caller needs it: the ids and prices a checkout will use, plus
 * the text the agent will be shown.
 *
 * The text is the *product's* — its description and key features — because a Channel3 offer has
 * none of its own (D67), and it is kept apart from the offers so nothing can mistake it for one
 * merchant's listing. Whoever shows it to an agent must label it untrusted; whoever records it must
 * record exactly what was shown.
 */
export interface SearchedProduct {
  productId: string;
  title: string;
  text: string | null;
  offers: Offer[];
}

/**
 * Every product in a search response, mapped the way a checkout maps one. A product that does not
 * parse is dropped rather than guessed at — the same rule the adapter follows.
 */
export function channel3SearchHits(body: unknown): SearchedProduct[] {
  const products = (body as { products?: unknown } | null)?.products;
  if (!Array.isArray(products)) {
    return [];
  }
  const hits: SearchedProduct[] = [];
  for (const raw of products) {
    const parsed = ProductSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }
    const productId = typeof parsed.data.id === "string" ? parsed.data.id.trim() : "";
    if (productId === "") {
      continue;
    }
    const offers: Offer[] = [];
    for (const candidate of parsed.data.offers) {
      const offer = channel3Offer(candidate);
      if (offer !== null) {
        offers.push(offer);
      }
    }
    hits.push({
      productId,
      title: typeof parsed.data.title === "string" ? parsed.data.title.trim() : "",
      text: productText(raw),
      offers,
    });
  }
  return hits;
}

const TextSchema = z
  .object({ description: z.unknown(), key_features: z.unknown() })
  .loose()
  .optional();

/** The description and the key features, joined, trimmed and capped. Null when there is none. */
function productText(raw: unknown): string | null {
  const parsed = TextSchema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    return null;
  }
  const description = typeof parsed.data.description === "string" ? parsed.data.description : "";
  const features = Array.isArray(parsed.data.key_features)
    ? parsed.data.key_features.filter((line): line is string => typeof line === "string")
    : [];
  const parts = [description, ...features].map((part) => part.trim()).filter((part) => part !== "");
  if (parts.length === 0) {
    return null;
  }
  // Capped rather than dropped: a very long description is still the text the agent was shown.
  return parts.join("\n").slice(0, PRODUCT_TEXT_LIMIT);
}
