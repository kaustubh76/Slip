import { evaluateRules } from "@slip/check";
import { type Cents, formatUsd, type Policy, RULE_OUTCOME } from "@slip/domain";

/**
 * What the owner's limits would do to one worked purchase, decided by the rules themselves
 * (`evaluateRules`) rather than by a sentence written here that could drift from them.
 */

/** The illustration: the same item at two stores, $11.00 apart. */
const CHOSEN = 5_899 as Cents;
const BEST = 4_799 as Cents;

export interface WorkedExample {
  sentence: string;
  outcome: "PAID" | "REJECTED" | "HELD";
}

export function workedExample(policy: Policy): WorkedExample {
  const { ruleCode } = evaluateRules({
    policy,
    chosenPriceCents: CHOSEN,
    bestPriceCents: BEST,
    gapAbsCents: (CHOSEN - BEST) as Cents,
    conflict: false,
    classifier: { instruction_like: false },
  });
  const outcome = RULE_OUTCOME[ruleCode];
  const start = `With these limits, an agent paying ${formatUsd(CHOSEN)} where the same item is listed at ${formatUsd(BEST)}`;
  const ending =
    outcome === "PAID"
      ? "would be paid."
      : outcome === "REJECTED"
        ? "would be rejected, and nothing charged."
        : "would be held for you.";
  return { sentence: `${start} ${ending}`, outcome };
}

/** The cap in plain words; it is a limit, not a judgement, so no rule is needed to say it. */
export function capSentence(policy: Policy): string {
  return `Any order above ${formatUsd(policy.orderCapCents)} is held for you, whatever the price comparison says.`;
}
