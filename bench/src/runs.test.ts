import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunOutcome } from "./run.js";
import { readRuns, recordedFor, writeRun } from "./runs.js";

/**
 * Which runs are already paid for. The question matters because the answer decides whether a sweep
 * spends money a second time on an errand that is already on disk — and because the wrong answer
 * would quietly mix answers to two different prompts into one table.
 */

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "slipbench-runs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const outcome = (over: {
  agent?: string;
  condition?: "clean" | "endorsed" | "injected";
  errandId?: string;
  promptVersion?: string;
}): RunOutcome => ({
  said: "bought it",
  record: {
    agent: over.agent ?? "claude-haiku-5-5",
    model: "claude-haiku-5-5",
    condition: over.condition ?? "clean",
    errandId: over.errandId ?? "norda-001",
    productId: "p1",
    choice: { kind: "bought", productId: "p1", offerUrl: "https://store.example/p1" },
    searches: 1,
    promptVersion: over.promptVersion ?? "bench-1",
    ranAt: "2026-10-21T09:00:00.000Z",
  },
});

describe("the runs already recorded", () => {
  it("keys them by agent, condition and errand, so one sweep's work is not redone", () => {
    writeRun(dir, outcome({}));
    writeRun(dir, outcome({ condition: "injected" }));
    writeRun(dir, outcome({ agent: "claude-opus-5-5", errandId: "lodge-skillet" }));

    const keys = recordedFor(dir, "bench-1");
    expect(keys.size).toBe(3);
    expect(keys.has("claude-haiku-5-5\u0000clean\u0000norda-001")).toBe(true);
    expect(keys.has("claude-haiku-5-5\u0000injected\u0000norda-001")).toBe(true);
    expect(keys.has("claude-opus-5-5\u0000clean\u0000lodge-skillet")).toBe(true);
    // Not the same errand under a condition nobody ran.
    expect(keys.has("claude-haiku-5-5\u0000endorsed\u0000norda-001")).toBe(false);
  });

  it("will not count a run recorded under another prompt as already paid for", () => {
    // The report names one prompt in its header, so keeping an older prompt's answer would publish
    // two prompts as one. It has to be paid for again.
    writeRun(dir, outcome({ promptVersion: "bench-0" }));
    expect(recordedFor(dir, "bench-1").size).toBe(0);
    expect(recordedFor(dir, "bench-0").size).toBe(1);
  });

  it("is empty for a directory nothing has been written to", () => {
    expect(recordedFor(dir, "bench-1").size).toBe(0);
    expect(readRuns(dir)).toEqual([]);
  });

  it("replaces the file for a re-run rather than accumulating a second one", () => {
    writeRun(dir, outcome({}));
    writeRun(dir, outcome({}));
    expect(readRuns(dir)).toHaveLength(1);
  });
});
