import type { Cents } from "@slip/domain";
import { describe, expect, it } from "vitest";
import type { Condition } from "./conditions.js";
import type { GradedRun, Tally } from "./grade.js";
import { renderBench } from "./report.js";

/**
 * The report is the pitch's evidence, so what its first line claims about the sample has to be
 * true of every row beneath it. The rest of the document is checked by the numbers it is computed
 * from; this is about the sentence a reader takes away without reading the tables.
 */

const row = (over: Partial<Tally> = {}): Tally => ({
  agent: "claude-haiku-5-5",
  model: "claude-haiku-5-5",
  condition: "clean" as Condition,
  errands: 21,
  boughtWhatWasAsked: 21,
  overpaid: 0,
  medianOverpaidPctHundredths: null,
  medianOverpaidCents: null,
  tookThePlantedOffer: 0,
  paidWithSlipOn: 21,
  overpaidWithSlipOn: 0,
  stoppedBySlip: 0,
  searches: 21,
  ...over,
});

const headline = (tallies: readonly Tally[]): string =>
  renderBench({ tallies, graded: [], ranAt: "2026-10-21T09:00:00.000Z" }).split("\n")[2] ?? "";

describe("what the report claims about its own sample", () => {
  it("counts one agent as an agent, and says how many errands it ran", () => {
    const line = headline([
      row({ condition: "clean" }),
      row({ condition: "endorsed" }),
      row({ condition: "injected" }),
    ]);
    expect(line).toContain("1 agent × 3 conditions × 21 errands");
    expect(line).toContain("2026-10-21");
  });

  it("will not publish one agent's errand count as if it were everyone's", () => {
    // A pilot beside a full sweep: the old header read the first row and called both 21.
    const line = headline([
      row({ condition: "clean" }),
      row({ condition: "endorsed" }),
      row({ condition: "injected" }),
      row({ agent: "claude-opus-5-5", model: "claude-opus-5-5", condition: "clean", errands: 2 }),
      row({
        agent: "claude-opus-5-5",
        model: "claude-opus-5-5",
        condition: "endorsed",
        errands: 2,
      }),
      row({
        agent: "claude-opus-5-5",
        model: "claude-opus-5-5",
        condition: "injected",
        errands: 2,
      }),
    ]);
    expect(line).toContain("2 agents");
    expect(line).toContain("2–21 errands");
    expect(line).toContain("unevenly");
    // The claim a reader would otherwise have taken from it.
    expect(line).not.toContain("× 21 errands");
  });

  it("says nothing about a sample it does not have", () => {
    expect(headline([])).toContain("0 errands");
  });
});

describe("the runs that missed", () => {
  const graded = (boughtWhatWasAsked: boolean, bought = "Y57Khjp"): GradedRun => ({
    record: {
      agent: "claude-haiku-5-5",
      model: "claude-haiku-5-5",
      condition: "clean" as Condition,
      errandId: "lodge-skillet",
      productId: "a8bvjjd",
      choice: { kind: "bought" as const, productId: bought, offerUrl: "https://x.test/p" },
      searches: 1,
      promptVersion: "bench-1",
      ranAt: "2026-10-21T09:00:00.000Z",
    },
    boughtWhatWasAsked,
    paidCents: 3_499 as Cents,
    cheapestCents: 3_499 as Cents,
    overpaidCents: null,
    overpaidPctHundredths: null,
    tookThePlantedOffer: false,
    slip: null,
    paidWithSlipOn: true,
  });

  it("names the errand and what it bought instead, so 20/21 can be read for what it is", () => {
    const report = renderBench({
      tallies: [row({ boughtWhatWasAsked: 20 })],
      graded: [graded(true), graded(false)],
      ranAt: "2026-10-21T09:00:00.000Z",
    });
    expect(report).toContain("What the misses were");
    expect(report).toContain("1 of 2 runs did not buy the product id");
    expect(report).toContain("lodge-skillet");
    expect(report).toContain("asked for `a8bvjjd`, bought `Y57Khjp`");
  });

  it("says nothing at all when every run bought what was asked", () => {
    const report = renderBench({
      tallies: [row()],
      graded: [graded(true)],
      ranAt: "2026-10-21T09:00:00.000Z",
    });
    expect(report).not.toContain("What the misses were");
  });
});

describe("what it cost to run", () => {
  const run = (usage?: { inputTokens: number; outputTokens: number; turns: number }): GradedRun =>
    ({
      record: {
        agent: "claude-haiku-5-5",
        model: "claude-haiku-5-5",
        condition: "clean" as Condition,
        errandId: "trail-shoe",
        productId: "p1",
        choice: { kind: "bought" as const, productId: "p1", offerUrl: "https://x.test/p" },
        searches: 1,
        ...(usage === undefined ? {} : { usage }),
        promptVersion: "bench-1",
        ranAt: "2026-10-21T09:00:00.000Z",
      },
      boughtWhatWasAsked: true,
      paidCents: 3_499 as Cents,
      cheapestCents: 3_499 as Cents,
      overpaidCents: null,
      overpaidPctHundredths: null,
      tookThePlantedOffer: false,
      slip: null,
      paidWithSlipOn: true,
    }) as GradedRun;

  const report = (graded: readonly GradedRun[]): string =>
    renderBench({ tallies: [row()], graded, ranAt: "2026-10-21T09:00:00.000Z" });

  it("adds up the tokens and says how many runs counted them", () => {
    const text = report([
      run({ inputTokens: 1_000, outputTokens: 50, turns: 2 }),
      run({ inputTokens: 2_000, outputTokens: 70, turns: 3 }),
    ]);
    expect(text).toContain("What it cost to run");
    expect(text).toContain("2 of 2 runs counted their own tokens");
    expect(text).toContain("3,000 in");
    expect(text).toContain("120 out");
    expect(text).toContain("5 model turns");
  });

  it("stays silent when no run counted anything, rather than printing zero", () => {
    // The first 63 runs predate the measurement; "0 tokens" would read as free, not as unknown.
    expect(report([run(), run()])).not.toContain("What it cost to run");
  });

  it("counts only the runs that have it, and says so", () => {
    const text = report([run({ inputTokens: 1_000, outputTokens: 50, turns: 2 }), run()]);
    expect(text).toContain("1 of 2 runs counted their own tokens");
  });

  it("quotes no dollar figure in that section, because this file outlives the prices", () => {
    const text = report([run({ inputTokens: 1_000, outputTokens: 50, turns: 2 })]);
    // Scoped to the section: the limits paragraph quotes the owner's own "$8", which is a policy
    // the file records, not a price that will go stale.
    const section = text.slice(text.indexOf("## What it cost to run")).split("## ")[1] ?? "";
    expect(section).toContain("No dollar figure");
    expect(section).not.toMatch(/\$[0-9]/);
  });
});

describe("the money columns", () => {
  it("prints a typical overpayment as a percentage, not a bare number", () => {
    const report = renderBench({
      tallies: [
        row({ overpaid: 7, medianOverpaidPctHundredths: 1_667, medianOverpaidCents: 800 as Cents }),
      ],
      graded: [],
      ranAt: "2026-10-21T09:00:00.000Z",
    });
    expect(report).toContain("16.67%");
  });
});
