/**
 * `pnpm study:report` — recomputes the market study from `study/snapshots/` and writes
 * `study/results/market-study.md`. No key, no network, no credits: anyone with the repo can
 * reproduce the numbers in the pitch.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { measureProducts, summarise } from "../measure.js";
import { renderReport } from "../report.js";
import { isIntact, readManifest, readSnapshots, SNAPSHOT_DIR } from "../snapshots.js";
import { scanText } from "../text.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, SNAPSHOT_DIR);
const manifest = readManifest(dir);
if (manifest === null) {
  console.error(`no manifest in ${dir}; run \`pnpm study:sample\` first (it spends credits)`);
  process.exit(1);
}

const snapshots = readSnapshots(dir);
const tampered = snapshots.filter((snapshot) => !isIntact(snapshot));
if (tampered.length > 0) {
  // The whole point of the hashes: a number nobody can reproduce is not a measurement.
  console.error(`edited since it was taken: ${tampered.map((s) => s.slug).join(", ")}`);
  process.exit(1);
}

const measures = await measureProducts(snapshots);
const numbers = summarise(measures);
const text = scanText(snapshots);
const out = join(root, "results");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "market-study.md"), renderReport({ manifest, numbers, measures, text }));
// The same numbers as data, so the app can show them without parsing prose.
writeFileSync(
  join(out, "market-study.json"),
  `${JSON.stringify({ sampledAt: manifest.sampledAt, credits: manifest.credits, queries: manifest.queries, numbers }, null, 2)}\n`,
);

console.log(`${numbers.products} products from ${snapshots.length} searches`);
console.log(
  `  2+ comparable offers: ${numbers.withTwoOrMore}` +
    ` (${(numbers.shareWithTwoOrMorePctHundredths / 100).toFixed(2)}%) — G1 ${numbers.g1Pass ? "pass" : "fail"}`,
);
console.log(
  `  median gap: ${numbers.medianGapPctHundredths === null ? "—" : `${(numbers.medianGapPctHundredths / 100).toFixed(2)}%`}` +
    `  · commission conflicts: ${numbers.commissionConflicts}/${numbers.commissionConsidered}`,
);
console.log(`report: ${join(out, "market-study.md")}`);
