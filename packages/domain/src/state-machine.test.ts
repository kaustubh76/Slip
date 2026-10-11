import { describe, expect, it } from "vitest";
import { HOLD_TRANSITIONS } from "./hold.js";
import { MANDATE_TRANSITIONS } from "./mandate.js";
import {
  canMove,
  classifyMove,
  isAcyclic,
  isReachable,
  type Transitions,
  terminalStatuses,
} from "./state-machine.js";

type S = "A" | "B" | "C" | "D";
const LINE: Transitions<S> = { A: ["B"], B: ["C"], C: [], D: [] };

describe("state machine helpers", () => {
  it("reachability follows one or more moves", () => {
    expect(isReachable(LINE, "A", "C")).toBe(true);
    expect(isReachable(LINE, "C", "A")).toBe(false);
    expect(isReachable(LINE, "A", "A")).toBe(false);
    expect(isReachable(LINE, "A", "D")).toBe(false);
  });

  it("classifies applied, unchanged, stale and illegal", () => {
    expect(classifyMove(LINE, "A", "B")).toBe("applied");
    expect(classifyMove(LINE, "B", "B")).toBe("unchanged");
    expect(classifyMove(LINE, "C", "A")).toBe("stale");
    expect(classifyMove(LINE, "A", "C")).toBe("illegal"); // forward but skips a step
    expect(classifyMove(LINE, "C", "D")).toBe("illegal");
  });

  it("detects cycles", () => {
    expect(isAcyclic(LINE)).toBe(true);
    expect(isAcyclic({ A: ["B"], B: ["A"] } as Transitions<"A" | "B">)).toBe(false);
  });

  it("lists terminal statuses", () => {
    expect(terminalStatuses(LINE).sort()).toEqual(["C", "D"]);
    expect(canMove(LINE, "A", "B")).toBe(true);
  });
});

describe("mandate statuses", () => {
  it("PENDING → ACTIVE → REVOKED, REVOKED is final", () => {
    expect(isAcyclic(MANDATE_TRANSITIONS)).toBe(true);
    expect(classifyMove(MANDATE_TRANSITIONS, "PENDING", "ACTIVE")).toBe("applied");
    expect(classifyMove(MANDATE_TRANSITIONS, "ACTIVE", "REVOKED")).toBe("applied");
    expect(classifyMove(MANDATE_TRANSITIONS, "PENDING", "REVOKED")).toBe("applied");
    // A late "activated" report after the owner revoked: ignored, never re-activates.
    expect(classifyMove(MANDATE_TRANSITIONS, "REVOKED", "ACTIVE")).toBe("stale");
    expect(terminalStatuses(MANDATE_TRANSITIONS)).toEqual(["REVOKED"]);
  });
});

describe("hold statuses", () => {
  it("PENDING decides once; decisions never change", () => {
    expect(isAcyclic(HOLD_TRANSITIONS)).toBe(true);
    for (const to of ["APPROVED", "DECLINED", "EXPIRED"] as const) {
      expect(classifyMove(HOLD_TRANSITIONS, "PENDING", to)).toBe("applied");
    }
    expect(classifyMove(HOLD_TRANSITIONS, "DECLINED", "APPROVED")).toBe("illegal");
    expect(classifyMove(HOLD_TRANSITIONS, "EXPIRED", "APPROVED")).toBe("illegal");
    expect(classifyMove(HOLD_TRANSITIONS, "APPROVED", "PENDING")).toBe("stale");
  });
});
