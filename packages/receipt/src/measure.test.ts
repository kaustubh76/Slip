import { DEFAULT_POLICY } from "@slip/domain";
import { offer, snapshot, testAttempt, testDecision } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { measureModel } from "./measure.js";

const receipt = (spec: Parameters<typeof testDecision>[0]) => ({
  attempt: testAttempt({ decision: testDecision(spec) }),
  payment: null,
  hold: null,
});

describe("measureModel", () => {
  it("the spec's example: $58.99 against $47.99 is $3.00 past a $55.99 limit", () => {
    const m = measureModel(
      receipt({
        ruleCode: "R4_OVERPAID",
        chosen: offer({ price: 58.99 }),
        best: offer({ price: 47.99 }),
      }),
      DEFAULT_POLICY,
      null,
    );
    expect(m).toMatchObject({
      width: 1000,
      low: { cents: 4_799, x: 0, label: "$47.99" },
      // $47.99 × 5 % is $2.39, less than the $8.00 allowance, so the limit is $55.99.
      limit: { cents: 5_599, label: "$55.99" },
      chosen: { cents: 5_899, label: "$58.99" },
      cap: null,
      ticks: [],
      pastLimit: "+$3.00 past your limit",
    });
    expect(m?.caption).toBe(
      "Lowest listed price $47.99. Within your limits up to $55.99. Your agent's choice, $58.99, is $3.00 past your limit.",
    );
    // Left to right: lowest, limit, choice, with room after the choice.
    expect(m && m.low.x < m.limit.x && m.limit.x < m.chosen.x && m.chosen.x < 1000).toBe(true);
  });

  it("the percent allowance wins on a dear item", () => {
    const m = measureModel(
      receipt({
        ruleCode: "R7_WITHIN_LIMITS",
        chosen: offer({ price: 410 }),
        best: offer({ price: 400 }),
      }),
      DEFAULT_POLICY,
      null,
    );
    // 5 % of $400.00 is $20.00, more than $8.00.
    expect(m?.limit.cents).toBe(42_000);
    expect(m?.pastLimit).toBeNull();
    expect(m?.caption).toContain("Your agent's choice, $410.00, is within them.");
  });

  it("shows the order cap when it held the purchase, even below the lowest price", () => {
    const m = measureModel(
      receipt({
        ruleCode: "R6_ABOVE_ORDER_CAP",
        chosen: offer({ price: 250 }),
        best: offer({ price: 249 }),
      }),
      DEFAULT_POLICY,
      null,
    );
    expect(m?.cap).toMatchObject({ cents: 20_000, x: 0 });
    expect(m?.low.x).toBeGreaterThan(m?.cap?.x ?? Number.POSITIVE_INFINITY);
    expect(m?.caption).toContain("Your order cap is $200.00.");
  });

  it("other comparable offers become ticks; used, out-of-stock and duplicate listings do not", () => {
    const chosen = offer({ price: 58.99 });
    const best = offer({ price: 47.99 });
    const other = offer({ price: 52 });
    const m = measureModel(
      receipt({ ruleCode: "R4_OVERPAID", chosen, best }),
      DEFAULT_POLICY,
      snapshot({
        offers: [
          chosen,
          best,
          other,
          { ...other },
          offer({ price: 40, condition: "used" }),
          offer({ price: 41, availability: "OutOfStock" }),
        ],
      }),
    );
    expect(m?.ticks.map((t) => t.cents)).toEqual([5_200]);
    expect(m?.caption).toContain("1 other comparable offer listed.");
  });

  it("is not drawn when no prices were compared, or the limits are unknown", () => {
    const stale = receipt({ ruleCode: "R1_STALE_SNAPSHOT", chosen: null, best: null });
    expect(measureModel(stale, DEFAULT_POLICY, null)).toBeNull();
    const paid = receipt({ ruleCode: "R7_WITHIN_LIMITS" });
    expect(measureModel(paid, undefined, null)).toBeNull();
  });
});
