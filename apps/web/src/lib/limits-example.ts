import { evaluateRules } from "@slip/check";
import { type Cents, formatUsd, type Policy, RULE_OUTCOME } from "@slip/domain";

/**
 * What the owner's limits would do to one worked purchase, decided by the rules themselves
 * (`evaluateRules`) rather than by a sentence written here that could drift from them.
 */

/** Where the illustration starts: the same item at two stores, $11.00 apart. */
export const EXAMPLE_CHOSEN = 5_899;
export const EXAMPLE_BEST = 4_799;

/** The limits as the owner types them: percents and dollars, not hundredths and cents. */
export interface LimitsDraft {
  maxOverpayPct: number;
  maxOverpayDollars: number;
  flagPct: number;
  orderCapDollars: number;
  snapshotMaxAgeMinutes: number;
}

/** Those numbers as the rules want them. The version is never read by a rule, only recorded. */
export function policyFrom(draft: LimitsDraft): Policy {
  return {
    version: 1,
    maxOverpayPctHundredths: Math.round(draft.maxOverpayPct * 100),
    maxOverpayAbsCents: Math.round(draft.maxOverpayDollars * 100),
    flagPctHundredths: Math.round(draft.flagPct * 100),
    orderCapCents: Math.round(draft.orderCapDollars * 100),
    snapshotMaxAgeMs: Math.round(draft.snapshotMaxAgeMinutes * 60_000),
  } as Policy;
}

export interface WorkedExample {
  sentence: string;
  outcome: "PAID" | "REJECTED" | "HELD";
}

export function workedExample(
  policy: Policy,
  prices: { chosenCents?: number; bestCents?: number } = {},
): WorkedExample {
  const chosen = Math.max(1, Math.round(prices.chosenCents ?? EXAMPLE_CHOSEN)) as Cents;
  const best = Math.min(chosen, Math.max(1, Math.round(prices.bestCents ?? EXAMPLE_BEST))) as Cents;
  const { ruleCode } = evaluateRules({
    policy,
    chosenPriceCents: chosen,
    bestPriceCents: best,
    gapAbsCents: (chosen - best) as Cents,
    conflict: false,
    // The example is about the owner's own limits, so it models a market with no commission
    // reported either way: neither R5 nor R5a has anything to say about it.
    chosenCommissionBps: null,
    bestCommissionBps: null,
    classifier: { instruction_like: false },
  });
  const outcome = RULE_OUTCOME[ruleCode];
  const start = `With these limits, an agent paying ${formatUsd(chosen)} where the same item is listed at ${formatUsd(best)}`;
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
