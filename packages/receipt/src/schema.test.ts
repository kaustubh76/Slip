import { DEFAULT_POLICY, type Hold, RULE_CODES, SYSTEM_DECIDER } from "@slip/domain";
import { offer, testAttempt, testDecision } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { ReceiptViewSchema } from "./schema.js";
import { followUp, hold, payment } from "./testing.js";
import { renderReceipt } from "./view.js";

const held = () =>
  testAttempt({
    decision: testDecision({
      ruleCode: "R6_ABOVE_ORDER_CAP",
      chosen: offer({ price: 250, rate: 0.08 }),
      best: offer({ price: 249, rate: 0.02 }),
    }),
  });

describe("ReceiptViewSchema", () => {
  it("every rendered view survives JSON and parses back to itself", () => {
    let checked = 0;
    for (const ruleCode of RULE_CODES) {
      const attempt = testAttempt({
        decision: testDecision({
          ruleCode,
          chosen: offer({ price: 110, rate: 0.08 }),
          best: offer({ price: 100, rate: 0.02 }),
          conflict: true,
        }),
      });
      const payments = [null, payment(attempt, "AUTHORIZED"), payment(attempt, "CAPTURED")];
      const holds: (Hold | null)[] = [
        null,
        hold(attempt),
        hold(attempt, "DECLINED", SYSTEM_DECIDER),
      ];
      for (const p of payments) {
        for (const h of holds) {
          const view = renderReceipt({ attempt, payment: p, hold: h }, { policy: DEFAULT_POLICY });
          const wire = JSON.parse(JSON.stringify(view));
          expect(ReceiptViewSchema.parse(wire)).toEqual(view);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(RULE_CODES.length * 9);
  });

  it("times are ISO strings in UTC", () => {
    const attempt = held();
    const view = renderReceipt({ attempt, payment: null, hold: hold(attempt) });
    expect(view.createdAt).toBe("2026-10-11T14:02:00.000Z");
    expect(view.hold?.expiresAt).toBe("2026-10-13T14:02:00.000Z");
  });

  it("refuses a view that is not one", () => {
    const attempt = held();
    const view = renderReceipt({ attempt, payment: null, hold: null });
    expect(ReceiptViewSchema.safeParse({ ...view, outcome: "MAYBE" }).success).toBe(false);
    expect(ReceiptViewSchema.safeParse({ ...view, createdAt: "yesterday" }).success).toBe(false);
  });
});

describe("the hold in the view", () => {
  it("says who decided and when, never the owner's id", () => {
    const attempt = held();
    const owner = renderReceipt({ attempt, payment: null, hold: hold(attempt, "APPROVED") });
    expect(owner.hold).toEqual({
      status: "APPROVED",
      expiresAt: "2026-10-13T14:02:00.000Z",
      decidedAt: "2026-10-11T14:05:00.000Z",
      decidedBy: "owner",
    });
    expect(JSON.stringify(owner)).not.toContain("owner-1");
    const system = renderReceipt({
      attempt,
      payment: null,
      hold: hold(attempt, "DECLINED", SYSTEM_DECIDER),
    });
    expect(system.hold?.decidedBy).toBe("system");
  });

  it("hints how a waiting hold would be approved, and nothing once it is decided", () => {
    const attempt = held();
    const waiting = (p: ReturnType<typeof payment> | null) =>
      renderReceipt({ attempt, payment: p, hold: hold(attempt) }).approval;
    expect(waiting(payment(attempt, "AUTHORIZED"))).toBe("capture");
    expect(waiting(null)).toBe("pay");
    expect(waiting(payment(attempt, "FAILED"))).toBe("pay");
    expect(waiting(payment(attempt, "UNKNOWN"))).toBe("not-ready");
    const decided = renderReceipt(
      { attempt, payment: null, hold: hold(attempt, "APPROVED") },
      { child: followUp(attempt, "CAPTURED") },
    );
    expect(decided.approval).toBe("none");
    expect(decided.state.charged).toBe(true);
  });
});
