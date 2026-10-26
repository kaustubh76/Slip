import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AgentRun, BenchAgent } from "./agent.js";
import { type Catalogue, loadCatalogue } from "./catalogue.js";
import { ERRANDS } from "./errands.js";
import { gradeRun, tally } from "./grade.js";
import { BENCH_POLICY } from "./policy.js";
import { PROMPT_VERSION } from "./prompt.js";
import { renderBench } from "./report.js";
import { type RunOutcome, runAll, runErrand } from "./run.js";

/**
 * The loop and the report, driven by scripted agents: one that always takes the first offer it is
 * shown, one that compares and takes the cheapest, and one that never buys. No model is called, so
 * this runs in the ordinary suite — and it is also how the loop was checked before any key existed.
 */

const SNAPSHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "study", "snapshots");
const errand = ERRANDS.find(
  (candidate) => candidate.id === "trinity-fkt",
) as (typeof ERRANDS)[number];

let catalogue: Catalogue;
const load = async () => {
  catalogue ??= await loadCatalogue(SNAPSHOTS);
  return catalogue;
};

/** Buys the first offer of the first result: the lazy agent the clean condition is about. */
const lazy: BenchAgent = {
  name: "lazy",
  provider: "scripted",
  model: "first-offer",
  async shop({ errand: task, tools }): Promise<AgentRun> {
    const page = tools.search(task.task, 1);
    const first = page.results.find((result) => result.productId === task.productId);
    const offer = first?.offers[0];
    if (first === undefined || offer === undefined) {
      return { choice: { kind: "gave-up", why: "not on page 1" }, searches: 1, said: "" };
    }
    tools.buy(first.productId, offer.url);
    return {
      choice: { kind: "bought", productId: first.productId, offerUrl: offer.url },
      searches: 1,
      said: "Bought the first one I saw.",
    };
  },
};

/** Compares every offer and takes the cheapest: the agent that needs no checking. */
const careful: BenchAgent = {
  ...lazy,
  name: "careful",
  model: "cheapest",
  async shop({ errand: task, tools }): Promise<AgentRun> {
    const page = tools.search(task.task, 1);
    const found = page.results.find((result) => result.productId === task.productId);
    const cheapest = [...(found?.offers ?? [])]
      // Cheapest of the offers a buyer could actually take: in stock, new, priced.
      .filter(
        (offer) =>
          offer.priceUsd !== "unknown" &&
          offer.availability === "InStock" &&
          offer.condition === "new",
      )
      .sort((a, b) => Number(a.priceUsd) - Number(b.priceUsd))[0];
    if (found === undefined || cheapest === undefined) {
      return { choice: { kind: "gave-up", why: "nothing priced" }, searches: 1, said: "" };
    }
    tools.buy(found.productId, cheapest.url);
    return {
      choice: { kind: "bought", productId: found.productId, offerUrl: cheapest.url },
      searches: 1,
      said: "Compared the listed prices and took the cheapest.",
    };
  },
};

const quitter: BenchAgent = {
  ...lazy,
  name: "quitter",
  model: "never-buys",
  async shop(): Promise<AgentRun> {
    return { choice: { kind: "gave-up", why: "did not try" }, searches: 0, said: "" };
  },
};

const now = () => new Date("2026-10-19T12:00:00.000Z");

describe("one errand", () => {
  it("records what the agent bought, under which condition, after how many searches", async () => {
    const outcome = await runErrand({
      agent: lazy,
      errand,
      condition: "clean",
      catalogue: await load(),
      now,
    });
    expect(outcome.record).toMatchObject({
      agent: "lazy",
      condition: "clean",
      errandId: "trinity-fkt",
      productId: errand.productId,
      searches: 1,
      promptVersion: PROMPT_VERSION,
    });
    expect(outcome.record.choice.kind).toBe("bought");
  });

  it("takes the agent's first buy as its decision, not its last", async () => {
    const fickle: BenchAgent = {
      ...lazy,
      name: "fickle",
      async shop({ errand: task, tools }): Promise<AgentRun> {
        const page = tools.search(task.task, 1);
        const found = page.results.find((result) => result.productId === task.productId);
        const [first, second] = found?.offers ?? [];
        if (first === undefined || second === undefined) {
          return { choice: { kind: "gave-up", why: "too few offers" }, searches: 1, said: "" };
        }
        tools.buy(found?.productId ?? "", first.url);
        tools.buy(found?.productId ?? "", second.url);
        return {
          choice: { kind: "gave-up", why: "said one thing, did another" },
          searches: 1,
          said: "",
        };
      },
    };
    const outcome = await runErrand({
      agent: fickle,
      errand,
      condition: "clean",
      catalogue: await load(),
      now,
    });
    // The tool log is what happened; the agent's own summary does not overrule it.
    expect(outcome.record.choice).toMatchObject({ kind: "bought" });
  });

  it("records giving up as a result, with the reason", async () => {
    const outcome = await runErrand({
      agent: quitter,
      errand,
      condition: "clean",
      catalogue: await load(),
      now,
    });
    expect(outcome.record.choice).toEqual({ kind: "gave-up", why: "did not try" });
  });
});

describe("what a run cost", () => {
  it("keeps the agent's own count, and leaves it out when a stand-in has none", async () => {
    const withCost = await runErrand({
      agent: {
        ...quitter,
        async shop(): Promise<AgentRun> {
          return {
            choice: { kind: "gave-up", why: "did not try" },
            searches: 0,
            said: "",
            usage: { inputTokens: 900, outputTokens: 40, turns: 2 },
          };
        },
      },
      errand,
      condition: "clean",
      catalogue: await load(),
      now,
    });
    expect(withCost.record.usage).toEqual({ inputTokens: 900, outputTokens: 40, turns: 2 });

    // A scripted stand-in spends nothing, and says so by omission rather than by claiming zero.
    const withNone = await runErrand({
      agent: quitter,
      errand,
      condition: "clean",
      catalogue: await load(),
      now,
    });
    expect("usage" in withNone.record).toBe(false);
  });
});

describe("a whole run", () => {
  it("leaves an errand alone when the caller says it is already paid for", async () => {
    const asked: string[] = [];
    const counting: BenchAgent = {
      ...lazy,
      name: "counting",
      async shop(input): Promise<AgentRun> {
        asked.push(`${input.condition}·${input.errand.id}`);
        return { choice: { kind: "gave-up", why: "noted" }, searches: 0, said: "" };
      },
    };
    const outcomes = await runAll({
      agents: [counting],
      errands: [errand],
      conditions: ["clean", "endorsed", "injected"],
      catalogue: await load(),
      now,
      save: () => {},
      // Pretend the clean one was recorded by an earlier sweep.
      skip: ({ condition }) => condition === "clean",
    });
    // The agent was never asked for the skipped one, which is the whole point: it costs money.
    expect(asked).toEqual([`endorsed·${errand.id}`, `injected·${errand.id}`]);
    // And no outcome is invented for it, so the report cannot count a run that did not happen.
    expect(outcomes).toHaveLength(2);
  });

  it("is every agent, condition and errand, each exactly once", async () => {
    const saved: RunOutcome[] = [];
    const errands = ERRANDS.slice(0, 3);
    await runAll({
      agents: [lazy, careful],
      errands,
      conditions: ["clean", "endorsed", "injected"],
      catalogue: await load(),
      now,
      save: (outcome) => saved.push(outcome),
    });
    expect(saved).toHaveLength(2 * 3 * 3);
    const keys = saved.map(
      (outcome) => `${outcome.record.agent}/${outcome.record.condition}/${outcome.record.errandId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("in the clean condition the catalogue's own order does not punish a lazy agent", async () => {
    // Worth knowing before reading any result: Channel3 returns these products cheapest-first, so
    // an agent that takes the first offer is accidentally right. Condition A measures exactly
    // this, and the endorsed and injected conditions are what change the order under it.
    const loaded = await load();
    const saved: RunOutcome[] = [];
    await runAll({
      agents: [lazy],
      errands: ERRANDS.slice(0, 6),
      conditions: ["clean"],
      catalogue: loaded,
      now,
      save: (outcome) => saved.push(outcome),
    });
    const graded = saved.map((outcome) =>
      gradeRun({
        record: outcome.record,
        product: loaded.product(outcome.record.productId),
        policy: BENCH_POLICY,
      }),
    );
    expect(tally(graded)[0]?.overpaid).toBe(0);
  });

  it("the lazy agent overpays where the careful one does not, and Slip stops it", async () => {
    const loaded = await load();
    const errands = ERRANDS.slice(0, 6);
    const saved: RunOutcome[] = [];
    await runAll({
      agents: [lazy, careful],
      errands,
      // Endorsed puts the dearest offer first, which is what a lazy agent then takes.
      conditions: ["endorsed"],
      catalogue: loaded,
      now,
      save: (outcome) => saved.push(outcome),
    });
    const graded = saved.map((outcome) =>
      gradeRun({
        record: outcome.record,
        product: loaded.product(outcome.record.productId),
        policy: BENCH_POLICY,
      }),
    );
    const rows = tally(graded);
    const lazyRow = rows.find((row) => row.agent === "lazy");
    const carefulRow = rows.find((row) => row.agent === "careful");
    expect(carefulRow?.overpaid).toBe(0);
    // Under the bench's policy the cap never decides an errand, so every careful purchase pays.
    expect(carefulRow?.boughtWhatWasAsked).toBeGreaterThan(0);
    expect(carefulRow?.paidWithSlipOn).toBe(carefulRow?.boughtWhatWasAsked);
    expect(lazyRow?.overpaid).toBeGreaterThan(0);
    // Whatever it overpaid, Slip either paid it within limits or stopped it; never silently both.
    expect((lazyRow?.overpaidWithSlipOn ?? 0) + (lazyRow?.stoppedBySlip ?? 0)).toBe(
      lazyRow?.overpaid,
    );
  });

  it("the report says what ran, what was synthetic, and how it reads G3", async () => {
    const loaded = await load();
    const saved: RunOutcome[] = [];
    await runAll({
      agents: [lazy],
      errands: ERRANDS.slice(0, 4),
      conditions: ["clean", "endorsed", "injected"],
      catalogue: loaded,
      now,
      save: (outcome) => saved.push(outcome),
    });
    const graded = saved.map((outcome) =>
      gradeRun({
        record: outcome.record,
        product: loaded.product(outcome.record.productId),
        policy: BENCH_POLICY,
      }),
    );
    const page = renderBench({
      tallies: tally(graded),
      graded,
      ranAt: "2026-10-19T12:00:00.000Z",
    });
    expect(page).toContain("# SlipBench");
    expect(page).toContain("[synthetic]");
    expect(page).toContain(`prompt \`${PROMPT_VERSION}\``);
    expect(page).toContain("with Slip switched on");
    expect(page).toMatch(/\*\*G3\*\* asks whether/);
  });
});
