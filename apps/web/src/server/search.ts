import "server-only";
import type { Clock, Logger, OffersFailure } from "@slip/domain";
import type { ProductSearch, SearchAnswer } from "@slip/mcp";
import { type Channel3Search, channel3SearchHits, createChannel3Search } from "@slip/offers/search";

/**
 * Channel3's catalogue, as the agents' search tool.
 *
 * Product detail is free; **search costs a credit**. So two limits sit in front of it, and both
 * belong here rather than in the port: a web deployment serving many agents needs them, a market
 * study taking one sample does not.
 *
 * - **A cache.** The same query and page within `CACHE_TTL_MS` is answered from the last result.
 *   An agent that searches, reads, and searches the same thing again pays once.
 * - **A budget.** One permission may spend `BUDGET_PER_HOUR` uncached searches an hour. Past that
 *   the tool refuses with `RATE_LIMITED`, which the MCP server already renders to the agent as an
 *   error naming the reason. Without it a looping agent could empty the owner's credits in
 *   minutes, and nothing else in Slip limits searches — the retry limit counts checkouts.
 *
 * Both are per process, so several replicas get several allowances. That is the same trade D66
 * accepted for resolving, and it is the right way round: the cost of a few extra searches is
 * small, and a shared counter would need a round trip on the agent's critical path.
 */

/** Identical queries inside this window are answered from the last result. */
const CACHE_TTL_MS = 5 * 60_000;
/** Uncached searches one permission may spend in an hour. */
const BUDGET_PER_HOUR = 60;
const HOUR_MS = 60 * 60_000;

export interface CatalogueSearchOptions {
  apiKey: string;
  clock: Clock;
  log: Logger;
  /** Injected in tests. */
  channel3?: Channel3Search;
}

/**
 * One searcher for the whole process, holding the cache and the budget. The MCP endpoint resolves
 * its `search` hook per session, so building this inside that hook would give every request a cold
 * cache and a fresh allowance.
 */
export interface CatalogueSearch {
  /** The tool for one permission, which is what the budget is counted against. */
  forMandate(mandateId: string): ProductSearch;
}

export function createCatalogueSearch(options: CatalogueSearchOptions): CatalogueSearch {
  const channel3 = options.channel3 ?? createChannel3Search({ apiKey: options.apiKey });
  const cached = new Map<string, { at: number; answer: SearchAnswer }>();
  const spent = new Map<string, number[]>();

  const budgetLeft = (mandateId: string, now: number): boolean => {
    const since = now - HOUR_MS;
    const recent = (spent.get(mandateId) ?? []).filter((at) => at > since);
    spent.set(mandateId, recent);
    return recent.length < BUDGET_PER_HOUR;
  };

  return {
    forMandate(mandateId) {
      return {
        simulated: false,
        async search(query, { limit }, signal): Promise<SearchAnswer> {
          const now = options.clock.now().getTime();
          const key = `${limit}\u0000${query.trim().toLowerCase()}`;
          const held = cached.get(key);
          if (held !== undefined && now - held.at < CACHE_TTL_MS) {
            return held.answer;
          }
          if (!budgetLeft(mandateId, now)) {
            options.log.warn("search.budget_spent", { mandateId });
            return {
              ok: false,
              reason: "RATE_LIMITED" satisfies OffersFailure,
              detail: `Slip's catalogue-search budget for this permission is used up (${BUDGET_PER_HOUR} an hour). Try again shortly, or buy from a product you have already found.`,
            };
          }
          spent.set(mandateId, [...(spent.get(mandateId) ?? []), now]);

          const outcome = await channel3.search(query, limit, signal);
          if (!outcome.ok) {
            // Not cached: a failure is not an answer, and the next call should really try again.
            return { ok: false, reason: failureFor(outcome.status), detail: outcome.detail };
          }
          const hits = channel3SearchHits(outcome.result.body);
          const answer: SearchAnswer = {
            ok: true,
            hits: hits.map((hit) => ({
              productId: hit.productId,
              title: hit.title,
              text: hit.text,
              offers: hit.offers,
            })),
            ...(hits.length === 0 ? { hint: "Channel3 listed nothing for that." } : {}),
          };
          cached.set(key, { at: now, answer });
          // Bounded: a long-running process must not accumulate every query ever asked.
          if (cached.size > 500) {
            for (const [stale, value] of cached) {
              if (now - value.at >= CACHE_TTL_MS) {
                cached.delete(stale);
              }
            }
          }
          return answer;
        },
      };
    },
  };
}

/** Channel3's documented statuses, as the offers port names them. */
function failureFor(status: number | null): OffersFailure {
  switch (status) {
    case 402:
      return "OUT_OF_CREDITS";
    case 429:
      return "RATE_LIMITED";
    case null:
      return "TIMEOUT";
    default:
      return "UNAVAILABLE";
  }
}
