import {
  type Cents,
  type ClassifierAnswer,
  gapExceedsPct,
  IMPLAUSIBLE_GAP_PCT_HUNDREDTHS,
  type Policy,
  type RuleCode,
} from "@slip/domain";

/** Everything the decision rules may look at. Nothing here came from the agent. */
export interface RuleContext {
  policy: Policy;
  chosenPriceCents: Cents;
  bestPriceCents: Cents;
  gapAbsCents: Cents;
  conflict: boolean;
  classifier: ClassifierAnswer;
}

interface Rule {
  code: RuleCode;
  when: (ctx: RuleContext) => boolean;
}

/** Gap strictly above the policy's flag line (1 % by default). */
function aboveFlagLine(ctx: RuleContext): boolean {
  return gapExceedsPct(ctx.gapAbsCents, ctx.bestPriceCents, ctx.policy.flagPctHundredths);
}

function instructionLike(ctx: RuleContext): boolean {
  return typeof ctx.classifier === "object" && ctx.classifier.instruction_like;
}

function noClassifierAnswer(ctx: RuleContext): boolean {
  return ctx.classifier === "NO_ANSWER" || ctx.classifier === "NOT_RUN";
}

/**
 * Rules R2a–R7, in order. The earlier steps (R1, variant, locate, R2) run in `prepareCheck`
 * because they decide whether there is anything to compare at all. First match wins; R7 is the
 * fallback and always matches.
 */
export const DECISION_RULES: readonly Rule[] = [
  {
    // First, because every rule below it reasons about a gap this one says not to trust. A
    // purchase here is held, not rejected: the comparison is suspect, the agent's choice is not.
    code: "R2A_GAP_IMPLAUSIBLE",
    when: (ctx) =>
      gapExceedsPct(ctx.gapAbsCents, ctx.bestPriceCents, IMPLAUSIBLE_GAP_PCT_HUNDREDTHS),
  },
  {
    code: "R3_STEERED",
    when: (ctx) => aboveFlagLine(ctx) && instructionLike(ctx),
  },
  {
    code: "R4_OVERPAID",
    when: (ctx) =>
      gapExceedsPct(ctx.gapAbsCents, ctx.bestPriceCents, ctx.policy.maxOverpayPctHundredths) &&
      ctx.gapAbsCents > ctx.policy.maxOverpayAbsCents,
  },
  {
    code: "R4A_NO_CLASSIFIER_ANSWER",
    when: (ctx) => aboveFlagLine(ctx) && noClassifierAnswer(ctx),
  },
  {
    code: "R5_COMMISSION_CONFLICT",
    when: (ctx) => aboveFlagLine(ctx) && ctx.conflict,
  },
  {
    code: "R6_ABOVE_ORDER_CAP",
    when: (ctx) => ctx.chosenPriceCents > ctx.policy.orderCapCents,
  },
  {
    code: "R7_WITHIN_LIMITS",
    when: () => true,
  },
];

export interface RuleEvaluation {
  /** The rule that decided: the first that matched. */
  ruleCode: RuleCode;
  /** Every rule that matched, deciding rule first. R7 is listed only when it decided. */
  ruleCodes: RuleCode[];
}

export function evaluateRules(ctx: RuleContext): RuleEvaluation {
  const tripped = DECISION_RULES.filter((rule) => rule.when(ctx)).map((rule) => rule.code);
  const [ruleCode] = tripped;
  if (ruleCode === undefined) {
    // Unreachable: R7 always matches. Kept so the type system does not need a non-null assertion.
    throw new Error("no decision rule matched");
  }
  const ruleCodes =
    tripped.length === 1 ? tripped : tripped.filter((code) => code !== "R7_WITHIN_LIMITS");
  return { ruleCode, ruleCodes };
}
