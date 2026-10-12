import { type AgentReport, agentId, type Cents } from "@slip/domain";
import { testUuid } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { pctFromHundredths, renderReport } from "./report-view.js";

const empty: AgentReport = {
  agentId: agentId(testUuid()),
  attempted: 0,
  paid: 0,
  rejected: 0,
  held: 0,
  captured: 0,
  notCheapest: 0,
  medianGapPctHundredths: null,
  worstGapPctHundredths: null,
  worstGapAbsCents: null,
  steered: 0,
  conflicts: 0,
};

describe("renderReport", () => {
  it("an agent with no purchases yet", () => {
    expect(renderReport(empty).lines).toEqual(["No purchases checked yet."]);
  });

  it("says what happened in plain words, singular and plural right", () => {
    const view = renderReport({
      ...empty,
      attempted: 12,
      paid: 9,
      rejected: 2,
      held: 1,
      captured: 10,
      notCheapest: 3,
      medianGapPctHundredths: 214,
      worstGapPctHundredths: 845,
      worstGapAbsCents: 1_120 as Cents,
      steered: 1,
      conflicts: 2,
    });
    expect(view.lines).toEqual([
      "12 purchases checked: 9 paid, 2 rejected, 1 held for the owner.",
      "10 payments completed.",
      "3 chosen offers were not the cheapest comparable one: typically 2.1% more, at most 8.5% or $11.20 more.",
      "1 listing carried text written to instruct AI shopping agents.",
      "2 times the pricier store paid a higher commission.",
    ]);
  });

  it("an agent that always chose the cheapest offer is told so", () => {
    const view = renderReport({ ...empty, attempted: 1, paid: 1, captured: 1 });
    expect(view.lines).toEqual([
      "1 purchase checked: 1 paid, 0 rejected, 0 held for the owner.",
      "1 payment completed.",
      "Every chosen offer was the cheapest comparable one.",
    ]);
  });

  it("never uses trading jargon", () => {
    const view = renderReport({
      ...empty,
      attempted: 2,
      notCheapest: 1,
      medianGapPctHundredths: 100,
      worstGapPctHundredths: 100,
      worstGapAbsCents: 100 as Cents,
      steered: 2,
      conflicts: 1,
    });
    for (const line of view.lines) {
      expect(line).not.toMatch(/basis points|\bbps\b|slippage|\bTCA\b|best execution|landed cost/i);
    }
  });
});

describe("pctFromHundredths", () => {
  it.each([
    [1_245, "12.5%"],
    [1_244, "12.4%"],
    [500, "5%"],
    [5, "0.1%"],
    [4, "0%"],
    [0, "0%"],
  ])("%i hundredths → %s", (value, shown) => {
    expect(pctFromHundredths(value)).toBe(shown);
  });
});
