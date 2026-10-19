import { createJsonClient, type Fetch, type JsonClient } from "@slip/http";
import { CHANNEL3_BASE_URL } from "@slip/offers";

/**
 * Channel3's search, which lives here and nowhere else.
 *
 * The production adapter never searches: product detail is free and search costs a credit, so
 * `@slip/offers` exposes only `fetchProduct` and the MCP server takes search as a host-supplied
 * hook (D54). The study is the one place that deliberately spends credits, so the call belongs to
 * the study. If search ever becomes part of the product, this moves — it does not get copied.
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
