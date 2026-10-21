/**
 * `pnpm bench:run` — runs SlipBench against real models. **This spends tokens**, so it prints what
 * it is about to do and does nothing until `--yes`.
 *
 * ```sh
 * ANTHROPIC_API_KEY=… pnpm bench:run                      # what it would run, and nothing else
 * ANTHROPIC_API_KEY=… pnpm bench:run --yes                # all agents, conditions and errands
 * ANTHROPIC_API_KEY=… pnpm bench:run --yes --errands 2 --conditions clean
 * ANTHROPIC_API_KEY=… pnpm bench:run --yes --again        # pay for runs already recorded
 * ```
 *
 * Runs are written to `bench/runs/` as they finish, so stopping it keeps what it paid for — and an
 * errand already recorded under this prompt version is not run again unless `--again` says so. A
 * run recorded under an *older* prompt is always run again: keeping it would mix answers to two
 * prompts into one table that names only one of them.
 * `pnpm bench:report` turns them into the results page, for free, as often as you like.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BenchAgent } from "../agent.js";
import { loadCatalogue } from "../catalogue.js";
import { createClaudeAgent } from "../claude-agent.js";
import { CONDITIONS, type Condition } from "../conditions.js";
import { ERRANDS } from "../errands.js";
import { describeEstimate, estimateSweep } from "../estimate.js";
import { PROMPT_VERSION } from "../prompt.js";
import { runAll } from "../run.js";
import { RUN_DIR, readRuns, recordedFor, writeRun } from "../runs.js";

/**
 * The agents that are wired. §6.2 asks for three across at least two providers; only Anthropic's
 * SDK is built, so this is two, one of them small and low-cost. A second provider would implement
 * `BenchAgent` (see `../agent.ts`) and join this list — nothing else here would change.
 */
const CLAUDE_MODELS = [
  { name: "claude-opus-5-5", model: "claude-opus-5-5" },
  { name: "claude-haiku-5-5", model: "claude-haiku-5-5" },
];

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};
const confirmed = argv.includes("--yes");
const again = argv.includes("--again");

const apiKey = process.env["ANTHROPIC_API_KEY"]?.trim();
if (apiKey === undefined || apiKey === "") {
  console.error("ANTHROPIC_API_KEY is not set; see docs/SERVICES.md");
  process.exit(1);
}

const only = flag("agents")?.split(",");
const agents: BenchAgent[] = CLAUDE_MODELS.filter(
  (candidate) => only === undefined || only.includes(candidate.name),
).map((candidate) => createClaudeAgent({ apiKey, model: candidate.model, name: candidate.name }));

const conditions: Condition[] = (flag("conditions")?.split(",") as Condition[] | undefined) ?? [
  ...CONDITIONS,
];
for (const condition of conditions) {
  if (!CONDITIONS.includes(condition)) {
    console.error(`no condition called ${condition}`);
    process.exit(1);
  }
}
const limit = Number(flag("errands") ?? ERRANDS.length);
const errands = ERRANDS.slice(0, Number.isFinite(limit) && limit > 0 ? limit : ERRANDS.length);

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dir = join(root, RUN_DIR);
const runs = agents.length * conditions.length * errands.length;
// What is already paid for, under this prompt. An older prompt's runs are not in here.
const recorded = again ? new Set<string>() : recordedFor(dir, PROMPT_VERSION);
const key = (agent: string, condition: string, errandId: string): string =>
  `${agent}\u0000${condition}\u0000${errandId}`;
let already = 0;
/** Errands this sweep will actually run, per agent: what the projection must be multiplied by. */
const toRun = new Map<string, number>();
for (const agent of agents) {
  for (const condition of conditions) {
    for (const errand of errands) {
      if (recorded.has(key(agent.name, condition, errand.id))) {
        already += 1;
      } else {
        toRun.set(agent.name, (toRun.get(agent.name) ?? 0) + 1);
      }
    }
  }
}
console.log(
  `${agents.length} agents × ${conditions.length} conditions × ${errands.length} errands` +
    ` = ${runs} errands, each several model turns with the catalogue in every tool result.`,
);
console.log(`agents: ${agents.map((agent) => agent.name).join(", ")}`);
console.log(`conditions: ${conditions.join(", ")}`);
if (already > 0) {
  console.log(
    `already recorded under prompt ${PROMPT_VERSION}: ${already} — not run again,` +
      ` so this spends on ${runs - already}. Add --again to pay for them anyway.`,
  );
} else if (again) {
  console.log("--again: nothing is skipped, including runs already recorded.");
}
if (runs - already > 0) {
  // Measured, not guessed, and in tokens: a rate belongs to whoever is about to pay it, and this
  // is the only moment the arithmetic is true.
  const stored = readRuns(dir);
  console.log("\nwhat it should cost:");
  for (const agent of agents) {
    const errandsLeft = toRun.get(agent.name) ?? 0;
    if (errandsLeft === 0) {
      continue;
    }
    const estimate = estimateSweep({
      runs: stored,
      agent: agent.name,
      errands: errandsLeft,
      promptVersion: PROMPT_VERSION,
    });
    console.log(`  ${describeEstimate(estimate, agent.name)}`);
  }
}
if (!confirmed) {
  console.log("\nNothing has been run. Add --yes to spend tokens.");
  process.exit(0);
}
if (already === runs) {
  console.log("\nEvery errand asked for is already recorded. Nothing to run, nothing spent.");
  process.exit(0);
}

const catalogue = await loadCatalogue(join(root, "..", "study", "snapshots"));
console.log(`\ncatalogue: ${catalogue.size()} products\n`);
mkdirSync(dir, { recursive: true });

const outcomes = await runAll({
  agents,
  errands,
  conditions,
  catalogue,
  now: () => new Date(),
  save: (outcome) => writeRun(dir, outcome),
  log: (line) => console.log(`  ${line}`),
  skip: ({ agent, condition, errand }) => recorded.has(key(agent.name, condition, errand.id)),
});

const bought = outcomes.filter((outcome) => outcome.record.choice.kind === "bought").length;
console.log(`\n${bought} of ${outcomes.length} errands ended in a purchase. Runs in ${dir}`);
console.log("`pnpm bench:report` turns them into bench/results/slipbench.md");
