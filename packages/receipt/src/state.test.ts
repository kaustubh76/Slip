import {
  type Attempt,
  type Hold,
  PAYMENT_STATUSES,
  type PaymentStatus,
  type Receipt,
  SYSTEM_DECIDER,
} from "@slip/domain";
import { offer, testAttempt, testDecision } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { followUp, hold, payment } from "./__fixtures__/receipts.js";
import { shortNo, utcDayTime } from "./format.js";
import { stateLine } from "./state.js";

const held = (): Attempt =>
  testAttempt({
    decision: testDecision({
      ruleCode: "R6_ABOVE_ORDER_CAP",
      chosen: offer({ price: 250, domain: "store-k.example" }),
      best: offer({ price: 249 }),
    }),
  });
const paid = (): Attempt =>
  testAttempt({
    decision: testDecision({
      ruleCode: "R7_WITHIN_LIMITS",
      chosen: offer({ price: 10, domain: "store-f.example" }),
    }),
  });

const STATUSES: (PaymentStatus | null)[] = [
  null,
  ...PAYMENT_STATUSES.filter((s): s is Exclude<PaymentStatus, "NONE"> => s !== "NONE"),
];
const HOLDS: (Hold["status"] | null)[] = [null, "PENDING", "APPROVED", "DECLINED", "EXPIRED"];

describe("stateLine — every combination keeps its promises", () => {
  const cases: { name: string; receipt: Receipt; child: Receipt | null }[] = [];
  for (const make of [held, paid]) {
    const attempt = make();
    for (const status of STATUSES) {
      for (const captureTried of [false, true]) {
        for (const h of HOLDS) {
          for (const by of ["owner-1", SYSTEM_DECIDER]) {
            for (const childStatus of [null, ...STATUSES]) {
              const receipt: Receipt = {
                attempt,
                payment: status === null ? null : payment(attempt, status, { captureTried }),
                hold: h === null ? null : hold(attempt, h, by),
              };
              const child =
                h === "APPROVED" && childStatus !== null ? followUp(attempt, childStatus) : null;
              cases.push({
                name: `${attempt.decision.outcome} ${status} capture:${captureTried} hold:${h} by:${by} child:${childStatus}`,
                receipt,
                child,
              });
            }
          }
        }
      }
    }
  }

  it(`holds for all ${cases.length} combinations of payment, hold and follow-up`, () => {
    for (const c of cases) {
      const line = stateLine(c.receipt, { store: "store-k.example", child: c.child });
      const where = `${c.name}: "${line.text}"`;
      // Money moved if and only if the line says CAPTURED, and only then does it say "Paid".
      expect(line.charged, where).toBe(line.word === "CAPTURED");
      if (line.word === "CAPTURED") {
        expect(line.text, where).toMatch(/Paid /);
        expect(line.text, where).not.toMatch(/[Nn]othing (was|is) charged/);
      } else {
        expect(line.text, where).not.toMatch(/\bPaid /);
      }
      // A closed hold never invites a decision.
      const closed = c.receipt.hold?.status === "DECLINED" || c.receipt.hold?.status === "EXPIRED";
      if (closed) {
        expect(line.text, where).not.toMatch(/until you decide|Approving checks again/);
      }
      // In flight means PayPal still has work to do: never on a final word.
      if (line.word === "CAPTURED" || line.word === "VOIDED" || line.word === "FAILED") {
        expect(line.inFlight, where).toBe(false);
      }
      expect(line.text.length, where).toBeGreaterThan(0);
    }
  });
});

describe("stateLine — the lines owners read", () => {
  it("a rejection made no order", () => {
    const attempt = testAttempt({ decision: testDecision({ ruleCode: "R4_OVERPAID" }) });
    expect(stateLine({ attempt, payment: null, hold: null }, { store: null, child: null })).toEqual(
      {
        glyph: null,
        word: "NONE",
        text: "No PayPal order was made. Nothing was charged.",
        inFlight: false,
        charged: false,
      },
    );
  });

  it("declined while PayPal had not answered: it says so once, never 'until you decide'", () => {
    const attempt = held();
    const line = stateLine(
      { attempt, payment: payment(attempt, "UNKNOWN"), hold: hold(attempt, "DECLINED") },
      { store: null, child: null },
    );
    expect(line).toMatchObject({ word: "UNKNOWN", inFlight: true, charged: false });
    expect(line.text).toBe(
      "You declined at 14:05 UTC. Slip releases the reservation as soon as PayPal confirms it; nothing was charged.",
    );
  });

  it("a reservation waiting for the owner names the deadline", () => {
    const attempt = held();
    const h = hold(attempt, "PENDING");
    const line = stateLine(
      { attempt, payment: payment(attempt, "AUTHORIZED"), hold: h },
      { store: null, child: null },
    );
    expect(line.text).toBe(
      `$250.00 is reserved, not charged, until you decide (by ${utcDayTime(h.expiresAt)}).`,
    );
    expect(utcDayTime(h.expiresAt)).toBe("13 Oct 14:02 UTC");
  });

  it("an order-less hold the owner approved is paid by its follow-up", () => {
    const attempt = held();
    const child = followUp(attempt, "CAPTURED");
    const line = stateLine(
      { attempt, payment: null, hold: hold(attempt, "APPROVED") },
      { store: "store-k.example", child },
    );
    expect(line).toMatchObject({ word: "CAPTURED", charged: true, glyph: "[x]" });
    expect(line.text).toBe(
      `You approved at 14:05 UTC. Paid $250.00 at store-k.example in one step (follow-up receipt no. ${shortNo(child.attempt.id)}).`,
    );
  });

  it("a revoke and an expiry say who let the hold go", () => {
    const attempt = held();
    const system = stateLine(
      {
        attempt,
        payment: payment(attempt, "VOIDED"),
        hold: hold(attempt, "DECLINED", SYSTEM_DECIDER),
      },
      { store: null, child: null },
    );
    expect(system.text).toBe(
      "Released when the mandate was revoked, at 14:05 UTC. Reservation released; nothing was charged.",
    );
    const expired = stateLine(
      { attempt, payment: payment(attempt, "VOIDED"), hold: hold(attempt, "EXPIRED") },
      { store: null, child: null },
    );
    expect(expired.text).toMatch(/^No decision within 48 hours; the hold expired at /);
  });
});

describe("format", () => {
  it("prints short receipt numbers and UTC day-times", () => {
    expect(shortNo("7c1e0000-0000-4000-8000-00000000a4f2")).toBe("7c1e…a4f2");
    expect(utcDayTime(new Date("2026-10-03T09:05:00Z"))).toBe("3 Oct 09:05 UTC");
  });
});
