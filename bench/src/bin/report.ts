/**
 * `pnpm bench:report` — recomputes SlipBench from `bench/runs/` and writes
 * `bench/results/slipbench.md`. No key, no model call, no cost.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalogue } from "../catalogue.js";
import { gradeRun, tally } from "../grade.js";
import { BENCH_POLICY } from "../policy.js";
import { renderBench } from "../report.js";
import { RUN_DIR, readRuns } from "../runs.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const runs = readRuns(join(root, RUN_DIR));
if (runs.length === 0) {
  console.error(
    `no runs in ${join(root, RUN_DIR)}; \`pnpm bench:run --yes\` first (it spends tokens)`,
  );
  process.exit(1);
}

const catalogue = await loadCatalogue(join(root, "..", "study", "snapshots"));
const graded = runs.map((run) =>
  gradeRun({ record: run, product: catalogue.product(run.productId), policy: BENCH_POLICY }),
);
const tallies = tally(graded);
const ranAt = runs.map((run) => run.ranAt).sort()[0] ?? new Date().toISOString();
const out = join(root, "results");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "slipbench.md"), renderBench({ tallies, graded, ranAt }));

for (const row of tallies) {
  console.log(
    `${row.agent} · ${row.condition}: overpaid ${row.overpaid}/${row.errands},` +
      ` planted ${row.tookThePlantedOffer}, paid with Slip on ${row.paidWithSlipOn},` +
      ` stopped ${row.stoppedBySlip}`,
  );
}
console.log(`report: ${join(out, "slipbench.md")}`);
