import type { Channel3Search } from "@slip/offers/search";
import type { SampleQuery } from "./queries.js";
import { hashOf, type Manifest, type Snapshot } from "./snapshots.js";

/**
 * Taking the sample. One search per query, in the order they are written, each response kept
 * before the next call goes out — so a sample that stops halfway still leaves everything it paid
 * for on disk.
 *
 * It never retries. A credit spent twice on the same query is a credit wasted, and a sample that
 * silently re-asks is a sample whose size nobody can state.
 */

export interface SampleReport {
  manifest: Manifest;
  /** Why the sample stopped early, if it did. */
  stoppedBecause: string | null;
}

export async function runSample(input: {
  search: Channel3Search;
  queries: readonly SampleQuery[];
  limit: number;
  now: () => Date;
  save: (snapshot: Snapshot) => void;
  log?: (line: string) => void;
  signal?: AbortSignal;
}): Promise<SampleReport> {
  const log = input.log ?? (() => {});
  const signal = input.signal ?? new AbortController().signal;
  const sampledAt = input.now().toISOString();
  const queries: Manifest["queries"] = [];
  let credits = 0;
  let stoppedBecause: string | null = null;

  for (const query of input.queries) {
    const outcome = await input.search.search(query.query, input.limit, signal);
    credits += 1;
    if (!outcome.ok) {
      stoppedBecause =
        outcome.status === 402
          ? `out of Channel3 credits after ${credits - 1} searches`
          : `${query.slug}: ${outcome.detail}`;
      log(`stopped: ${stoppedBecause}`);
      break;
    }
    const snapshot: Snapshot = {
      slug: query.slug,
      query: query.query,
      fetchedAt: input.now().toISOString(),
      rawHash: hashOf(outcome.result.body),
      body: outcome.result.body,
    };
    input.save(snapshot);
    queries.push({
      slug: query.slug,
      query: query.query,
      products: outcome.result.products.length,
    });
    log(`${query.slug}: ${outcome.result.products.length} products`);
  }

  // A failed call still cost a credit, so the count is attempts, not successes.
  return { manifest: { sampledAt, credits, queries }, stoppedBecause };
}
