import { describe, expect, it } from "vitest";
import { describeEstimate, estimateSweep } from "./estimate.js";
import type { StoredRun } from "./runs.js";

/**
 * The number printed before anyone spends anything. Its job is to be true at the moment it is
 * read, which is why it is measured from recorded runs and quoted in tokens — and why it refuses
 * to exist at all for an agent nobody has run.
 */

const run = (over: {
  agent?: string;
  promptVersion?: string;
  usage?: { inputTokens: number; outputTokens: number; turns: number };
}): StoredRun =>
  ({
    agent: over.agent ?? "claude-haiku-5-5",
    model: over.agent ?? "claude-haiku-5-5",
    condition: "clean",
    errandId: "norda-001",
    productId: "p1",
    choice: { kind: "bought", productId: "p1", offerUrl: "https://store.example/p1" },
    searches: 1,
    ...(over.usage === undefined ? {} : { usage: over.usage }),
    promptVersion: over.promptVersion ?? "bench-1",
    ranAt: "2026-10-21T09:00:00.000Z",
    said: "bought it",
  }) as StoredRun;

const usage = (inputTokens: number, outputTokens: number) => ({
  inputTokens,
  outputTokens,
  turns: 2,
});

describe("projecting what a sweep will cost", () => {
  it("averages the runs it has and multiplies by the errands still to run", () => {
    const estimate = estimateSweep({
      runs: [run({ usage: usage(1_000, 100) }), run({ usage: usage(2_000, 200) })],
      agent: "claude-haiku-5-5",
      errands: 10,
      promptVersion: "bench-1",
    });
    // Mean of 1_500 in and 150 out, over ten errands.
    expect(estimate).toMatchObject({
      basis: 2,
      errands: 10,
      inputTokens: 15_000,
      outputTokens: 1_500,
    });
    expect(estimate?.fromAnotherPrompt).toBe(false);
  });

  it("refuses to estimate an agent nobody has run, rather than guessing", () => {
    const estimate = estimateSweep({
      runs: [run({ usage: usage(1_000, 100) })],
      agent: "claude-opus-5-5",
      errands: 63,
      promptVersion: "bench-1",
    });
    expect(estimate).toBeNull();
    expect(describeEstimate(estimate, "claude-opus-5-5")).toContain("no measured basis yet");
  });

  it("ignores runs recorded before anything counted its tokens", () => {
    // The first 63 runs have no usage at all; they are not a basis for anything.
    expect(
      estimateSweep({
        runs: [run({}), run({})],
        agent: "claude-haiku-5-5",
        errands: 5,
        promptVersion: "bench-1",
      }),
    ).toBeNull();
  });

  it("prefers this prompt's runs, and says so when it had to fall back", () => {
    const mixed = [
      run({ promptVersion: "bench-0", usage: usage(5_000, 500) }),
      run({ promptVersion: "bench-1", usage: usage(1_000, 100) }),
    ];
    const current = estimateSweep({
      runs: mixed,
      agent: "claude-haiku-5-5",
      errands: 1,
      promptVersion: "bench-1",
    });
    expect(current).toMatchObject({ basis: 1, inputTokens: 1_000, fromAnotherPrompt: false });

    const fallback = estimateSweep({
      runs: [mixed[0] as StoredRun],
      agent: "claude-haiku-5-5",
      errands: 1,
      promptVersion: "bench-1",
    });
    expect(fallback).toMatchObject({ inputTokens: 5_000, fromAnotherPrompt: true });
    expect(describeEstimate(fallback, "claude-haiku-5-5")).toContain("of an older prompt");
  });

  it("has nothing to say about a sweep that will run nothing", () => {
    expect(
      estimateSweep({
        runs: [run({ usage: usage(1_000, 100) })],
        agent: "claude-haiku-5-5",
        errands: 0,
        promptVersion: "bench-1",
      }),
    ).toBeNull();
  });

  it("quotes tokens and no price", () => {
    const line = describeEstimate(
      estimateSweep({
        runs: [run({ usage: usage(1_000, 100) })],
        agent: "claude-haiku-5-5",
        errands: 63,
        promptVersion: "bench-1",
      }),
      "claude-haiku-5-5",
    );
    expect(line).toContain("63,000 input");
    expect(line).toContain("quotes no prices");
    expect(line).not.toMatch(/\$[0-9]/);
  });
});
