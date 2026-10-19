/**
 * `pnpm bench:run` — runs SlipBench against real models. **This spends tokens**, so it prints what
 * it is about to do and does nothing until `--yes`.
 *
 * ```sh
 * ANTHROPIC_API_KEY=… pnpm bench:run                      # what it would run, and nothing else
 * ANTHROPIC_API_KEY=… pnpm bench:run --yes                # all agents, conditions and errands
 * ANTHROPIC_API_KEY=… pnpm bench:run --yes --errands 2 --conditions clean
 * ```
 *
 * Runs are written to `bench/runs/` as they finish, so stopping it keeps what it paid for.
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
import { runAll } from "../run.js";
import { RUN_DIR, writeRun } from "../runs.js";

/** The three agents §6.2 asks for. The third needs a second provider's key — see docs/SERVICES.md. */
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
const runs = agents.length * conditions.length * errands.length;
console.log(
  `${agents.length} agents × ${conditions.length} conditions × ${errands.length} errands` +
    ` = ${runs} errands, each several model turns with the catalogue in every tool result.`,
);
console.log(`agents: ${agents.map((agent) => agent.name).join(", ")}`);
console.log(`conditions: ${conditions.join(", ")}`);
if (!confirmed) {
  console.log("\nNothing has been run. Add --yes to spend tokens.");
  process.exit(0);
}

const catalogue = await loadCatalogue(join(root, "..", "study", "snapshots"));
console.log(`\ncatalogue: ${catalogue.size()} products\n`);
const dir = join(root, RUN_DIR);
mkdirSync(dir, { recursive: true });

const outcomes = await runAll({
  agents,
  errands,
  conditions,
  catalogue,
  now: () => new Date(),
  save: (outcome) => writeRun(dir, outcome),
  log: (line) => console.log(`  ${line}`),
});

const bought = outcomes.filter((outcome) => outcome.record.choice.kind === "bought").length;
console.log(`\n${bought} of ${outcomes.length} errands ended in a purchase. Runs in ${dir}`);
console.log("`pnpm bench:report` turns them into bench/results/slipbench.md");
