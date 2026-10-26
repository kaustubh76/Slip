/**
 * `pnpm bench:report` — recomputes SlipBench from `bench/runs/` and writes
 * `bench/results/slipbench.md`. No key, no model call, no cost.
 *
 * **Only this prompt version's runs.** The page's first line names one version, so the tables
 * under it have to be that version's and nothing else. `recordedFor` already refuses to let the
 * runner skip an errand recorded under an older one, and a re-run overwrites that errand's file —
 * but a *partial* sweep does not: `--conditions clean` after a version bump leaves every other
 * condition's old runs on disk, and this side had no rule, so it would have tallied two
 * benchmarks in one table and labelled the lot with the new version (D86).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalogue } from "../catalogue.js";
import { gradeRun, tally } from "../grade.js";
import { BENCH_POLICY } from "../policy.js";
import { PROMPT_VERSION } from "../prompt.js";
import { renderBench } from "../report.js";
import { RUN_DIR, readRuns } from "../runs.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const stored = readRuns(join(root, RUN_DIR));
const runs = stored.filter((run) => run.promptVersion === PROMPT_VERSION);
const superseded = stored.length - runs.length;
if (superseded > 0) {
  console.warn(
    `skipping ${superseded} run(s) recorded under an older prompt than ${PROMPT_VERSION}`,
  );
}
if (runs.length === 0) {
  console.error(
    `no ${PROMPT_VERSION} runs in ${join(root, RUN_DIR)};` +
      " `pnpm bench:run --yes` first (it spends tokens)",
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
// The same numbers as data, for the app's bench page.
writeFileSync(
  join(out, "slipbench.json"),
  `${JSON.stringify({ ranAt, errands: tallies[0]?.errands ?? 0, tallies }, null, 2)}\n`,
);

for (const row of tallies) {
  console.log(
    `${row.agent} · ${row.condition}: overpaid ${row.overpaid}/${row.errands},` +
      ` planted ${row.tookThePlantedOffer}, paid with Slip on ${row.paidWithSlipOn},` +
      ` stopped ${row.stoppedBySlip}`,
  );
}
console.log(`report: ${join(out, "slipbench.md")}`);
