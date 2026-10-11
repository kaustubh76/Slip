import { describe, expect, it } from "vitest";
import {
  CHECK_RESULT_VERSION,
  CheckoutRequestSchema,
  CheckResultSchema,
  parseStoredCheckResult,
  RULE_CODES,
  RULE_OUTCOME,
} from "./attempt.js";
import { InvariantError } from "./errors.js";
import { agentId, isUuid } from "./ids.js";
import { offer, testDecision, testUuid } from "./testing/index.js";

describe("CheckResult storage round trip", () => {
  it("a check result survives JSON (as stored in jsonb) unchanged, dates included", () => {
    const { checkResult } = testDecision({
      ruleCode: "R5_COMMISSION_CONFLICT",
      chosen: offer({ price: 103, rate: 0.08 }),
      best: offer({ price: 100, rate: 0.02 }),
      conflict: true,
      classifier: { instruction_like: false },
      alsoTripped: ["R6_ABOVE_ORDER_CAP"],
    });
    const stored = JSON.parse(JSON.stringify(checkResult));
    expect(typeof stored.snapshotFetchedAt).toBe("string");
    expect(parseStoredCheckResult(CHECK_RESULT_VERSION, stored)).toEqual(checkResult);
  });

  it("refuses a corrupt row instead of guessing", () => {
    const { checkResult } = testDecision({ ruleCode: "R7_WITHIN_LIMITS" });
    const corrupt = { ...JSON.parse(JSON.stringify(checkResult)), gapAbsCents: -5 };
    expect(() => CheckResultSchema.parse(corrupt)).toThrow();
  });

  it("refuses an unknown version", () => {
    expect(() => parseStoredCheckResult(99, {})).toThrow(InvariantError);
  });
});

describe("rule codes", () => {
  it("every rule code maps to an outcome", () => {
    expect(Object.keys(RULE_OUTCOME).sort()).toEqual([...RULE_CODES].sort());
    expect(RULE_OUTCOME.OWNER_APPROVED).toBe("PAID");
  });
});

describe("ids", () => {
  it("accepts UUIDs, lower-cases them, refuses anything else", () => {
    const upper = testUuid(0xabc).toUpperCase();
    expect(agentId(upper)).toBe(upper.toLowerCase());
    expect(() => agentId("agent-1")).toThrow();
    expect(isUuid("not-a-uuid")).toBe(false);
  });

  it("the checkout request needs a UUID agent id", () => {
    expect(() =>
      CheckoutRequestSchema.parse({
        agentId: "agent-1",
        productId: "p",
        chosenOfferUrl: "https://s.example/p",
        reason: "",
      }),
    ).toThrow();
  });
});
