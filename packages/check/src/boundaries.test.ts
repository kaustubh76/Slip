import { DEFAULT_POLICY, policyWith, RULE_OUTCOME } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { minutesFromNow, NOW, offer, runCheck, snapshot } from "./__fixtures__/builders.js";
import { isSnapshotFresh } from "./freshness.js";

/** Two-offer market: the best at `bestPrice`, the chosen at `chosenPrice`. */
function market(bestPrice: number, chosenPrice: number) {
  const best = offer({ price: bestPrice });
  const chosen = offer({ price: chosenPrice });
  return { snapshot: snapshot({ offers: [best, chosen] }), chosen: chosen.url };
}

describe("R2a the implausible gap: the catalogue is doubted, not the agent", () => {
  it("exactly 100 % below does not trip: a half-price store is possible", () => {
    // Strictly above, like every other threshold in the check.
    expect(runCheck(market(100.0, 200.0)).ruleCode).toBe("R4_OVERPAID");
  });

  it("one cent past 100 % holds instead of rejecting", () => {
    const check = runCheck(market(100.0, 200.01));
    expect(check.ruleCode).toBe("R2A_GAP_IMPLAUSIBLE");
    expect(RULE_OUTCOME[check.ruleCode]).toBe("HELD");
  });

  it("the skillet from the market study: $39.99 against $637 is held, not rejected", () => {
    // study/results/market-study.md — Channel3 filed two different pans under one product id.
    // Rejecting here would refuse a correct purchase of the item the agent actually chose.
    const check = runCheck(market(39.99, 637.0));
    expect(check.ruleCode).toBe("R2A_GAP_IMPLAUSIBLE");
  });

  it("still reports that the overpay rule tripped, so the receipt shows the whole picture", () => {
    const check = runCheck(market(39.99, 637.0));
    expect(check.checkResult.ruleCodes).toContain("R2A_GAP_IMPLAUSIBLE");
    expect(check.checkResult.ruleCodes).toContain("R4_OVERPAID");
    // The deciding rule comes first (D9).
    expect(check.checkResult.ruleCodes[0]).toBe("R2A_GAP_IMPLAUSIBLE");
  });

  it("decides before the steering rule, whose gap it does not trust either", () => {
    const check = runCheck({
      ...market(10.0, 500.0),
      classifier: { instruction_like: true },
    });
    expect(check.ruleCode).toBe("R2A_GAP_IMPLAUSIBLE");
  });

  it("leaves an ordinary market alone, however wide the gap is below the line", () => {
    // 99.9 %: implausible is a high bar, not a second overpay threshold.
    expect(runCheck(market(100.0, 199.9)).ruleCode).toBe("R4_OVERPAID");
  });

  it("never fires when the chosen offer is the cheapest", () => {
    expect(runCheck(market(637.0, 39.99)).ruleCode).toBe("R7_WITHIN_LIMITS");
  });
});

describe("R4 overpaid: both halves must exceed, strictly", () => {
  it("exactly 5 % and exactly $8 does not trip", () => {
    expect(runCheck(market(160.0, 168.0)).ruleCode).toBe("R7_WITHIN_LIMITS");
  });

  it("one cent more trips (5.006 % and $8.01)", () => {
    expect(runCheck(market(160.0, 168.01)).ruleCode).toBe("R4_OVERPAID");
  });

  it("above 5 % but within the $8 allowance passes (shipping allowance)", () => {
    // 7.99 % and $7.99 — the allowance is meant for exactly this.
    expect(runCheck(market(100.0, 107.99)).ruleCode).toBe("R7_WITHIN_LIMITS");
  });

  it("a cheap item far over 5 % but under $8 passes — documented behaviour", () => {
    // 39.95 % and $7.99. The owner can lower maxOverpayAbsCents if they disagree.
    expect(runCheck(market(20.0, 27.99)).ruleCode).toBe("R7_WITHIN_LIMITS");
  });

  it("above $8 but within 5 % passes", () => {
    // 4.74 % and $9, kept under the $200 cap so R6 stays out of it.
    expect(runCheck(market(190.0, 199.0)).ruleCode).toBe("R7_WITHIN_LIMITS");
  });

  it("the $8 line is strict too: $8.00 at 5.1 % passes, $8.01 trips", () => {
    expect(runCheck(market(156.0, 164.0)).ruleCode).toBe("R7_WITHIN_LIMITS"); // 5.128 %, $8.00
    expect(runCheck(market(156.0, 164.01)).ruleCode).toBe("R4_OVERPAID"); // 5.135 %, $8.01
  });

  it("owner-edited thresholds are honoured: 7.5 % and $20", () => {
    const policy = policyWith(DEFAULT_POLICY, {
      maxOverpayPctHundredths: 750,
      maxOverpayAbsCents: 2000,
    });
    expect(runCheck({ ...market(100.0, 112.0), policy }).ruleCode).toBe("R7_WITHIN_LIMITS");
    expect(runCheck({ ...market(100.0, 127.51), policy }).ruleCode).toBe("R4_OVERPAID");
  });
});

describe("the 1 % flag line decides whether the classifier matters", () => {
  it("exactly 1 % is not above the line: no classifier needed, NOT_RUN is fine", () => {
    const decision = runCheck({ ...market(100.0, 101.0), classifier: "NOT_RUN" });
    expect(decision.ruleCode).toBe("R7_WITHIN_LIMITS");
    expect(decision.checkResult.classifier).toBe("NOT_RUN");
  });

  it("one cent above 1 % is above the line: NOT_RUN → HELD", () => {
    const decision = runCheck({ ...market(100.0, 101.01), classifier: "NOT_RUN" });
    expect(decision.ruleCode).toBe("R4A_NO_CLASSIFIER_ANSWER");
  });

  it("odd base: 33 cents on $33.33 is 0.99 %, 34 cents is 1.02 %", () => {
    expect(runCheck({ ...market(33.33, 33.66), classifier: "NOT_RUN" }).ruleCode).toBe(
      "R7_WITHIN_LIMITS",
    );
    expect(runCheck({ ...market(33.33, 33.67), classifier: "NOT_RUN" }).ruleCode).toBe(
      "R4A_NO_CLASSIFIER_ANSWER",
    );
  });

  it("a zero gap with instruction-like text is still PAID", () => {
    const decision = runCheck({ ...market(50.0, 50.0), classifier: { instruction_like: true } });
    expect(decision.ruleCode).toBe("R7_WITHIN_LIMITS");
    expect(decision.checkResult.gapAbsCents).toBe(0);
  });

  it("a conflict at exactly 1 % does not hold", () => {
    const best = offer({ price: 100.0, rate: 0.02 });
    const chosen = offer({ price: 101.0, rate: 0.08 });
    const decision = runCheck({
      snapshot: snapshot({ offers: [best, chosen] }),
      chosen: chosen.url,
    });
    expect(decision.ruleCode).toBe("R7_WITHIN_LIMITS");
    expect(decision.checkResult.conflict).toBe(true); // recorded, not acted on
  });
});

describe("R6 order cap", () => {
  it("exactly $200 passes, $200.01 is held, and a raised cap is honoured", () => {
    expect(runCheck(market(199.0, 200.0)).ruleCode).toBe("R7_WITHIN_LIMITS");
    expect(runCheck(market(199.01, 200.01)).ruleCode).toBe("R6_ABOVE_ORDER_CAP");
    const policy = policyWith(DEFAULT_POLICY, { orderCapCents: 50_000 });
    expect(runCheck({ ...market(199.01, 200.01), policy }).ruleCode).toBe("R7_WITHIN_LIMITS");
  });
});

describe("R1 snapshot freshness", () => {
  it("exactly 10 minutes old is fresh; one millisecond more is stale", () => {
    const fresh = snapshot({ offers: [], fetchedAt: minutesFromNow(-10) });
    const stale = snapshot({ offers: [], fetchedAt: new Date(minutesFromNow(-10).getTime() - 1) });
    expect(isSnapshotFresh(fresh, DEFAULT_POLICY, NOW)).toBe(true);
    expect(isSnapshotFresh(stale, DEFAULT_POLICY, NOW)).toBe(false);
  });

  it("a snapshot from the future is fresh", () => {
    expect(
      isSnapshotFresh(snapshot({ offers: [], fetchedAt: minutesFromNow(5) }), DEFAULT_POLICY, NOW),
    ).toBe(true);
  });

  it("the policy's own max age is used", () => {
    const policy = policyWith(DEFAULT_POLICY, { snapshotMaxAgeMs: 60_000 });
    const twoMinutes = snapshot({ offers: [], fetchedAt: minutesFromNow(-2) });
    expect(isSnapshotFresh(twoMinutes, policy, NOW)).toBe(false);
    expect(isSnapshotFresh(twoMinutes, DEFAULT_POLICY, NOW)).toBe(true);
  });
});
