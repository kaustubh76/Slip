/**
 * `pnpm bench:judge` — puts SlipBench's one supplied input to the real classifier.
 *
 * **This spends tokens**, so it prints what it is about to ask and does nothing until `--yes`.
 *
 * ```sh
 * pnpm bench:judge                                        # what it would ask, free, no key
 * ANTHROPIC_API_KEY=… pnpm bench:judge --yes --limit 3    # a pilot, a few cents
 * ANTHROPIC_API_KEY=… pnpm bench:judge --yes              # the whole sample
 * ```
 *
 * The dry run needs no key because the questions are built by pure code: `list()` produces the text
 * and `buildPrompt` fences it, so the number of calls and the exact size of what would be sent are
 * measured rather than projected. Writes `bench/results/steering-judge.{md,json}`, from which the
 * page recomputes for free, as every other results page in this repository does.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { buildPrompt, createClaudeSteeringClassifier, STEERING_MODEL } from "@slip/steering";
import { loadCatalogue } from "../catalogue.js";
import { asksFor, type JudgeResult, judge, renderJudge, tallyJudged } from "../judge.js";

/** What the application allows the check (`classifierTimeoutMs`, `packages/app/src/config.ts`). */
const DEADLINE_MS = 5_000;
/** Four at a time: enough to finish the sample in minutes, far short of any published rate limit. */
const CONCURRENCY = 4;

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = argv.indexOf(`--${name}`);
  return at === -1 ? undefined : argv[at + 1];
};
const confirmed = argv.includes("--yes");
const limit = Number(flag("limit") ?? Number.NaN);

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const catalogue = await loadCatalogue(join(root, "..", "study", "snapshots"));
const all = asksFor(catalogue.all());
const asks = Number.isFinite(limit) && limit > 0 ? all.slice(0, limit) : all;

const count = (arm: string): number => asks.filter((ask) => ask.arm === arm).length;
// Built, not guessed: the same prompt the adapter would send, minus the nonce's randomness.
const chars = asks.reduce((total, ask) => {
  const prompt = buildPrompt(
    { listingText: "", productTitle: ask.title, searchContext: ask.text },
    "0".repeat(32),
  );
  return total + prompt.system.length + prompt.user.length;
}, 0);

console.log(
  `${asks.length} call(s) of ${all.length}: ${count("honest")} honest, ${count("buried")} buried,` +
    ` over ${catalogue.size()} products.`,
);
console.log(
  `About ${chars.toLocaleString("en-US")} characters of prompt in total, measured by building` +
    " every one of them. Multiply by your own rate; this prints no prices.",
);

if (!confirmed) {
  console.log("Nothing sent. Add `--yes` to ask the model.");
  process.exit(0);
}

const apiKey = process.env["ANTHROPIC_API_KEY"]?.trim();
if (apiKey === undefined || apiKey === "") {
  console.error("ANTHROPIC_API_KEY is not set; see docs/SERVICES.md");
  process.exit(1);
}

/**
 * One `count_tokens` call, so the per-check input size in the report is a measurement. It is the
 * real prompt for the first ask, on the model the check uses.
 */
const inputTokens = await (async (): Promise<number | null> => {
  const first = asks[0];
  if (first === undefined) {
    return null;
  }
  const prompt = buildPrompt(
    { listingText: "", productTitle: first.title, searchContext: first.text },
    "0".repeat(32),
  );
  try {
    const counted = await new Anthropic({ apiKey, maxRetries: 0 }).messages.countTokens({
      model: STEERING_MODEL,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
    return counted.input_tokens;
  } catch (error) {
    // A missing figure is better than an invented one; the sweep is what was paid for.
    console.warn(`count_tokens failed, so the report will say so: ${String(error)}`);
    return null;
  }
})();

const classifier = createClaudeSteeringClassifier({ apiKey });
const judged = await judge({
  asks,
  classifier,
  deadlineMs: DEADLINE_MS,
  concurrency: CONCURRENCY,
  onDone: (done, total) => {
    if (done % 20 === 0 || done === total) {
      console.log(`  ${done}/${total}`);
    }
  },
});

const first = judged[0];
const result: JudgeResult = {
  ranAt: new Date().toISOString(),
  model: first?.model ?? STEERING_MODEL,
  promptVersion: first?.promptVersion ?? "unknown",
  deadlineMs: DEADLINE_MS,
  inputTokens,
  tally: tallyJudged(judged),
  judged,
};

const out = join(root, "results");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "steering-judge.md"), renderJudge(result));
writeFileSync(join(out, "steering-judge.json"), `${JSON.stringify(result, null, 2)}\n`);

for (const arm of [result.tally.honest, result.tally.buried]) {
  console.log(
    `${arm.arm}: asked ${arm.asked}, flagged ${arm.flagged}, clear ${arm.clear},` +
      ` no answer ${arm.noAnswer}, slowest ${(arm.slowestMs / 1000).toFixed(1)} s`,
  );
}
console.log(`report: ${join(out, "steering-judge.md")}`);
