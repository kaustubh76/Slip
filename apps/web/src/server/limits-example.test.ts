import { DEFAULT_POLICY, policyWith } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { capSentence, workedExample } from "./limits-example";

describe("workedExample", () => {
  it("the default limits reject $58.99 against $47.99: 22.9 % and $11.00 over", () => {
    expect(workedExample(DEFAULT_POLICY)).toEqual({
      outcome: "REJECTED",
      sentence:
        "With these limits, an agent paying $58.99 where the same item is listed at $47.99 would be rejected, and nothing charged.",
    });
  });

  it("follows the owner's own limits, because it asks the rules", () => {
    // Allow 30 % and $20: the same purchase now passes.
    const loose = policyWith(DEFAULT_POLICY, {
      maxOverpayPctHundredths: 3_000,
      maxOverpayAbsCents: 2_000,
    });
    expect(workedExample(loose).outcome).toBe("PAID");
    // A $50 cap holds it instead, even though the price comparison is happy.
    expect(workedExample(policyWith(loose, { orderCapCents: 5_000 })).outcome).toBe("HELD");
  });

  it("states the cap in the owner's own numbers", () => {
    expect(capSentence(DEFAULT_POLICY)).toBe(
      "Any order above $200.00 is held for you, whatever the price comparison says.",
    );
  });
});
