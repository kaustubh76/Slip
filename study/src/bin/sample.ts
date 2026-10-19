/**
 * `pnpm study:sample` — takes the market study's sample. **Spends one Channel3 credit per query**
 * (eight by default) and writes `study/snapshots/`, which is committed.
 *
 * Run it once. `pnpm study:report` recomputes the numbers from those files for free, as often as
 * you like.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { RESULTS_PER_QUERY, SAMPLE_QUERIES } from "../queries.js";
import { runSample } from "../sample.js";
import { createChannel3Search } from "../search.js";
import { SNAPSHOT_DIR, writeManifest, writeSnapshot } from "../snapshots.js";

const apiKey = process.env["CHANNEL3_API_KEY"]?.trim();
if (apiKey === undefined || apiKey === "") {
  console.error("CHANNEL3_API_KEY is not set; see docs/SERVICES.md");
  process.exit(1);
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", SNAPSHOT_DIR);
mkdirSync(dir, { recursive: true });

console.log(
  `sampling ${SAMPLE_QUERIES.length} queries × ${RESULTS_PER_QUERY} results` +
    ` — this spends up to ${SAMPLE_QUERIES.length} Channel3 credits`,
);

const { manifest, stoppedBecause } = await runSample({
  search: createChannel3Search({ apiKey }),
  queries: SAMPLE_QUERIES,
  limit: RESULTS_PER_QUERY,
  now: () => new Date(),
  save: (snapshot) => writeSnapshot(dir, snapshot),
  log: (line) => console.log(`  ${line}`),
  // The whole sample shares one deadline: eight searches, generously.
  signal: AbortSignal.timeout(5 * 60_000),
});
writeManifest(dir, manifest);

const products = manifest.queries.reduce((total, query) => total + query.products, 0);
console.log(
  `\n${manifest.queries.length} queries, ${products} products, ${manifest.credits} credits spent.`,
);
console.log(`snapshots in ${dir}`);
if (stoppedBecause !== null) {
  console.error(`stopped early: ${stoppedBecause}`);
  process.exit(1);
}
