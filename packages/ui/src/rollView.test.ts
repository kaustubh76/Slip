import { DEFAULT_POLICY } from "@slip/domain";
import { offer, testAttempt, testDecision } from "@slip/domain/testing";
import type { AgentCard, ReceiptRow } from "@slip/receipt";
import { renderReceipt } from "@slip/receipt";
import { describe, expect, it } from "vitest";
import { countByOutcome, dayOf, dayStarts, filterRows, summariseAgents } from "./rollView.js";

const row = (
  rule: Parameters<typeof testDecision>[0]["ruleCode"],
  createdAt: string,
): ReceiptRow => {
  const attempt = testAttempt({
    decision: testDecision({
      ruleCode: rule,
      chosen: offer({ price: 10 }),
      best: offer({ price: 9 }),
    }),
    createdAt: new Date(createdAt),
  });
  return {
    view: renderReceipt({ attempt, payment: null, hold: null }, { policy: DEFAULT_POLICY }),
    agent: { id: "a1", name: "shopper-1" },
  };
};

const card = (report: Partial<AgentCard["report"]["report"]>): AgentCard =>
  ({
    agent: {
      id: "a1",
      name: "shopper-1",
      apiKeyPrefix: "slip_live_ab",
      createdAt: "2026-10-19T00:00:00.000Z",
      revokedAt: null,
    },
    report: {
      lines: [],
      report: {
        agentId: "a1",
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
        ...report,
      },
    },
  }) as AgentCard;

describe("summariseAgents", () => {
  it("adds every agent's report card up, because those count the whole desk", () => {
    expect(
      summariseAgents([
        card({ attempted: 4, paid: 1, rejected: 1, held: 2, captured: 1, notCheapest: 1 }),
        card({ attempted: 2, paid: 2, captured: 2, steered: 1 }),
      ]),
    ).toEqual({
      agents: 2,
      attempted: 6,
      paid: 3,
      rejected: 1,
      held: 2,
      captured: 3,
      notCheapest: 1,
      steered: 1,
    });
  });

  it("is all zeroes for a desk with no agents yet", () => {
    expect(summariseAgents([])).toMatchObject({ agents: 0, attempted: 0, paid: 0 });
  });
});

describe("the roll's own rows", () => {
  const rows = [
    row("R7_WITHIN_LIMITS", "2026-10-19T09:00:00.000Z"),
    row("R4_OVERPAID", "2026-10-19T08:00:00.000Z"),
    row("R6_ABOVE_ORDER_CAP", "2026-10-18T22:00:00.000Z"),
  ];

  it("counts what is loaded by outcome, which is what a filter narrows", () => {
    expect(countByOutcome(rows)).toEqual({ PAID: 1, REJECTED: 1, HELD: 1 });
    expect(countByOutcome([])).toEqual({ PAID: 0, REJECTED: 0, HELD: 0 });
  });

  it("keeps every row for no filter, and only the asked-for outcome otherwise", () => {
    expect(filterRows(rows, null)).toHaveLength(3);
    expect(filterRows(rows, "PAID").map((r) => r.view.outcome)).toEqual(["PAID"]);
    expect(filterRows(rows, "HELD")).toHaveLength(1);
  });

  it("marks the first receipt of each day, in UTC, and no others", () => {
    expect(dayOf(rows[0] as ReceiptRow)).toBe("19 Oct 2026");
    const starts = dayStarts(rows);
    expect([...starts.values()]).toEqual(["19 Oct 2026", "18 Oct 2026"]);
    expect(starts.has((rows[1] as ReceiptRow).view.receiptId)).toBe(false);
    expect(dayStarts([])).toEqual(new Map());
  });
});
