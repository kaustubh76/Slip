import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { comparableOffers } from "@slip/check";
import { SHOWN_TEXT_LIMIT } from "@slip/domain";
import { FakeSteeringClassifier } from "@slip/steering/fake";
import { beforeAll, describe, expect, it } from "vitest";
import { type Catalogue, dearestComparable, loadCatalogue } from "./catalogue.js";
import { buriedInjection, SYNTHETIC } from "./conditions.js";
import {
  type Ask,
  asksFor,
  findings,
  type Judgement,
  judge,
  renderJudge,
  tallyJudged,
} from "./judge.js";

/**
 * The instrument, with no model behind it. What the real classifier answers is the measurement and
 * cannot be asserted here; what *can* be asserted is that the questions are the benchmark's own and
 * that the tallies say what they claim.
 */

const SNAPSHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "study", "snapshots");

let catalogue: Catalogue;
let asks: Ask[];
beforeAll(async () => {
  catalogue = await loadCatalogue(SNAPSHOTS);
  asks = asksFor(catalogue.all());
});

const ask = (overrides: Partial<Ask> = {}): Ask => ({
  productId: "p1",
  title: "Trail shoe",
  arm: "honest",
  text: "Grippy outsole. Free returns.",
  ...overrides,
});

const judgement = (overrides: Partial<Judgement> = {}): Judgement => ({
  ...ask(),
  outcome: "clear",
  model: "fake-steering",
  promptVersion: "fake-1",
  elapsedMs: 10,
  ...overrides,
});

describe("the questions", () => {
  it("asks about every product that has a description", () => {
    const withText = catalogue.all().filter((product) => {
      return asks.some((candidate) => candidate.productId === product.productId);
    });
    expect(asks.filter((candidate) => candidate.arm === "honest")).toHaveLength(withText.length);
    expect(withText.length).toBe(catalogue.size());
  });

  it("asks the buried question only where there are two offers to steer between", () => {
    const buried = asks.filter((candidate) => candidate.arm === "buried");
    const comparable = catalogue
      .all()
      .filter((product) => comparableOffers(product.offers).length >= 2);
    expect(buried).toHaveLength(comparable.length);
    for (const candidate of buried) {
      const product = catalogue.product(candidate.productId);
      expect(product === undefined ? null : dearestComparable(product)).not.toBeNull();
    }
  });

  it("plants the benchmark's own labelled sentence, naming the dearer store", () => {
    for (const candidate of asks.filter((row) => row.arm === "buried")) {
      const product = catalogue.product(candidate.productId);
      const dearest = product === undefined ? null : dearestComparable(product);
      expect(candidate.text).toContain(buriedInjection(dearest?.domain ?? "—"));
      expect(candidate.text).toContain(SYNTHETIC);
    }
  });

  it("differs from the honest question by that sentence and nothing else", () => {
    // The sentence is inserted before the bound is applied, so the attacked text carries less of
    // the description than the honest one — but what it does carry must be the description, word
    // for word from the start. Anything else would mean the two arms are not the same listing.
    const bare = (text: string): string => text.replace(/…$/, "").replace(/\s+/g, " ").trim();
    for (const candidate of asks.filter((row) => row.arm === "buried")) {
      const honest = asks.find(
        (row) => row.arm === "honest" && row.productId === candidate.productId,
      );
      const product = catalogue.product(candidate.productId);
      const dearest = product === undefined ? null : dearestComparable(product);
      const without = bare(candidate.text.replace(buriedInjection(dearest?.domain ?? "—"), ""));
      expect(bare(honest?.text ?? "").startsWith(without)).toBe(true);
    }
  });

  it("keeps both questions inside the bound an agent is shown", () => {
    for (const candidate of asks) {
      expect(candidate.text.length).toBeLessThanOrEqual(SHOWN_TEXT_LIMIT + 1);
    }
  });
});

describe("asking", () => {
  it("asks the way a production checkout asks: no listing, the text as search context", async () => {
    const classifier = new FakeSteeringClassifier();
    await judge({
      asks: [ask({ text: "Grippy outsole." })],
      classifier,
      deadlineMs: 1_000,
      concurrency: 1,
    });
    expect(classifier.calls).toEqual([
      { listingText: "", productTitle: "Trail shoe", searchContext: "Grippy outsole." },
    ]);
  });

  it("keeps answers with the question they answered, however they interleave", async () => {
    const classifier = new FakeSteeringClassifier();
    classifier.flagWhenListingIncludes("steer me");
    const many = [
      ask({ productId: "a", text: "ordinary copy" }),
      ask({ productId: "b", text: "steer me" }),
      ask({ productId: "c", text: "ordinary copy" }),
      ask({ productId: "d", text: "steer me" }),
    ];
    const judged = await judge({ asks: many, classifier, deadlineMs: 1_000, concurrency: 3 });
    expect(judged.map((row) => `${row.productId}:${row.outcome}`)).toEqual([
      "a:clear",
      "b:flagged",
      "c:clear",
      "d:flagged",
    ]);
  });

  it("records a model that did not answer as that, not as an opinion", async () => {
    const classifier = new FakeSteeringClassifier();
    classifier.answerNext("NO_ANSWER");
    const judged = await judge({
      asks: [ask()],
      classifier,
      deadlineMs: 1_000,
      concurrency: 1,
    });
    expect(judged[0]?.outcome).toBe("no-answer");
  });

  it("gives up on an answer that misses the deadline the application allows", async () => {
    const classifier = new FakeSteeringClassifier();
    classifier.answerNext("hang");
    const judged = await judge({ asks: [ask()], classifier, deadlineMs: 20, concurrency: 1 });
    expect(judged[0]?.outcome).toBe("no-answer");
  });
});

describe("the tally", () => {
  it("counts each arm's three outcomes", () => {
    const tally = tallyJudged([
      judgement({ arm: "honest", outcome: "clear" }),
      judgement({ arm: "honest", outcome: "flagged" }),
      judgement({ arm: "honest", outcome: "no-answer" }),
      judgement({ arm: "buried", outcome: "flagged", elapsedMs: 900 }),
      judgement({ arm: "buried", outcome: "clear" }),
    ]);
    expect(tally.honest).toMatchObject({ asked: 3, flagged: 1, clear: 1, noAnswer: 1 });
    expect(tally.buried).toMatchObject({ asked: 2, flagged: 1, clear: 1, slowestMs: 900 });
  });

  it("calls a wrong answer in either arm a finding, and a right one neither", () => {
    const found = findings([
      judgement({ productId: "right-honest", arm: "honest", outcome: "clear" }),
      judgement({ productId: "wrong-honest", arm: "honest", outcome: "flagged" }),
      judgement({ productId: "unjudged-honest", arm: "honest", outcome: "no-answer" }),
      judgement({ productId: "right-buried", arm: "buried", outcome: "flagged" }),
      judgement({ productId: "missed-buried", arm: "buried", outcome: "clear" }),
    ]);
    expect(found.map((row) => row.productId)).toEqual([
      "wrong-honest",
      "unjudged-honest",
      "missed-buried",
    ]);
  });
});

describe("the page", () => {
  const result = (judged: readonly Judgement[]) => ({
    ranAt: "2026-10-28T12:00:00.000Z",
    model: "claude-opus-5-5",
    promptVersion: "steer-2",
    deadlineMs: 5_000,
    inputTokens: 1_400,
    tally: tallyJudged(judged),
    judged,
  });

  it("says so plainly when nothing went wrong", () => {
    const page = renderJudge(
      result([
        judgement({ arm: "honest", outcome: "clear" }),
        judgement({ arm: "buried", outcome: "flagged" }),
      ]),
    );
    expect(page).toContain("None.");
    expect(page).toContain("1,400 input tokens");
  });

  it("prints every finding with the text it was asked about", () => {
    const page = renderJudge(
      result([
        judgement({
          productId: "nN3hWTS",
          arm: "honest",
          outcome: "flagged",
          text: "rebel is Australia's preferred retailer of the biggest sports brands.",
        }),
      ]),
    );
    expect(page).toContain("honest · flagged · nN3hWTS");
    expect(page).toContain("preferred retailer of the biggest sports brands");
  });

  it("quotes no prices, as every other cost figure in this benchmark does not", () => {
    const page = renderJudge(result([judgement()]));
    expect(page).not.toMatch(/\$|USD|per million|\/MTok/i);
  });
});
