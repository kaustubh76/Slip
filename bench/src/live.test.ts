import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadCatalogue } from "./catalogue.js";
import { createClaudeAgent } from "./claude-agent.js";
import { ERRANDS } from "./errands.js";
import { gradeRun } from "./grade.js";
import { BENCH_POLICY } from "./policy.js";
import { runErrand } from "./run.js";

/**
 * One real errand against one real model (`ANTHROPIC_API_KEY=… pnpm test:live:bench`), to prove the
 * loop works against the API before `pnpm bench:run` spends tokens on 126 of them.
 *
 * It asserts the *mechanism*, never the model's choice: whether an agent overpays is the thing the
 * benchmark measures, so a test that required a particular purchase would be marking its own
 * homework. One errand, a few model turns, a cent or two.
 */

const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
const SNAPSHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "study", "snapshots");

if (apiKey === "") {
  describe("SlipBench, live", () => {
    it.skip("skipped: set ANTHROPIC_API_KEY (pnpm test:live:bench)", () => {});
  });
} else {
  describe("SlipBench, live", () => {
    it("shops one errand end to end: searches, buys, and is graded", async () => {
      const catalogue = await loadCatalogue(SNAPSHOTS);
      const errand = ERRANDS.find((candidate) => candidate.id === "trinity-fkt");
      if (errand === undefined) {
        throw new Error("the trinity-fkt errand has gone");
      }
      const agent = createClaudeAgent({
        apiKey,
        model: "claude-haiku-5-5",
        name: "claude-haiku-5-5",
        maxTurns: 6,
      });
      const outcome = await runErrand({
        agent,
        errand,
        condition: "clean",
        catalogue,
        now: () => new Date(),
      });

      // It must have used the tool rather than answered from nothing.
      expect(outcome.record.searches).toBeGreaterThan(0);
      expect(outcome.said).not.toBe("");
      if (outcome.record.choice.kind === "gave-up") {
        // A model that cannot do the errand is a result, not a broken test — but say which.
        console.warn(`the model gave up: ${outcome.record.choice.why}`);
        return;
      }
      expect(outcome.record.choice.productId).toBe(errand.productId);
      const graded = gradeRun({
        record: outcome.record,
        product: catalogue.product(errand.productId),
        policy: BENCH_POLICY,
      });
      expect(graded.boughtWhatWasAsked).toBe(true);
      expect(graded.paidCents).not.toBeNull();
      // Whatever it chose, the check has an opinion and the grader recorded it.
      expect(graded.slip?.outcome).toMatch(/^(PAID|REJECTED|HELD)$/);
    }, 120_000);
  });
}
