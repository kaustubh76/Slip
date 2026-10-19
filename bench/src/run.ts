import type { AgentTools, BenchAgent } from "./agent.js";
import type { Catalogue } from "./catalogue.js";
import type { Condition } from "./conditions.js";
import type { Errand } from "./errands.js";
import type { Choice, RunRecord } from "./grade.js";
import { PROMPT_VERSION } from "./prompt.js";

/**
 * Running the benchmark: every agent, every condition, every errand, one attempt each.
 *
 * An errand is never retried. A model that fails or refuses is recorded as having given up, which
 * is a result — "this agent could not do the errand" is exactly as interesting as what it bought,
 * and a silent retry would turn a failure into a second chance nobody else got.
 *
 * Each record is handed to `save` as it finishes, so a run stopped halfway keeps what it paid for.
 */

export interface RunOutcome {
  record: RunRecord;
  /** What the agent said it did, kept beside the record for the write-up. */
  said: string;
}

export async function runErrand(input: {
  agent: BenchAgent;
  errand: Errand;
  condition: Condition;
  catalogue: Catalogue;
  now: () => Date;
}): Promise<RunOutcome> {
  const { agent, errand, condition, catalogue } = input;
  // What the tools actually saw, held in an object: TypeScript cannot follow a `let` that only a
  // closure assigns, and would decide it is forever null.
  const log: { searches: number; bought: { productId: string; offerUrl: string } | null } = {
    searches: 0,
    bought: null,
  };
  const tools: AgentTools = {
    search(query, page) {
      log.searches += 1;
      return catalogue.search(query, page, condition);
    },
    buy(productId, offerUrl) {
      // The first buy is the decision; a second is the agent changing its mind too late.
      log.bought ??= { productId, offerUrl };
    },
  };

  const run = await agent.shop({ errand, condition, tools });
  const viaTool = log.bought;
  const choice: Choice =
    run.choice.kind === "bought"
      ? run.choice
      : viaTool === null
        ? run.choice
        : { kind: "bought", productId: viaTool.productId, offerUrl: viaTool.offerUrl };
  return {
    said: run.said,
    record: {
      agent: agent.name,
      model: agent.model,
      condition,
      errandId: errand.id,
      productId: errand.productId,
      choice,
      // The agent's own count is trusted only as far as the tool log agrees.
      searches: Math.max(log.searches, run.searches),
      promptVersion: PROMPT_VERSION,
      ranAt: input.now().toISOString(),
    },
  };
}

export async function runAll(input: {
  agents: readonly BenchAgent[];
  errands: readonly Errand[];
  conditions: readonly Condition[];
  catalogue: Catalogue;
  now: () => Date;
  save: (outcome: RunOutcome) => void;
  log?: (line: string) => void;
}): Promise<RunOutcome[]> {
  const log = input.log ?? (() => {});
  const outcomes: RunOutcome[] = [];
  for (const agent of input.agents) {
    for (const condition of input.conditions) {
      for (const errand of input.errands) {
        const outcome = await runErrand({
          agent,
          errand,
          condition,
          catalogue: input.catalogue,
          now: input.now,
        });
        input.save(outcome);
        outcomes.push(outcome);
        log(
          `${agent.name} · ${condition} · ${errand.id}: ` +
            (outcome.record.choice.kind === "bought"
              ? `bought after ${outcome.record.searches} searches`
              : `gave up (${outcome.record.choice.why})`),
        );
      }
    }
  }
  return outcomes;
}
