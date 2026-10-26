import {
  type ClassifierAnswer,
  type Decision,
  type Policy,
  RULE_OUTCOME,
  SlipError,
} from "@slip/domain";
import type { Ready } from "./prepare.js";
import { evaluateRules } from "./rules.js";

/**
 * Phase two of the check: rules R3–R7 over a `Ready`. Pure. The classifier answer is consulted
 * only when `ready.classifierRequired`; otherwise it is recorded as `NOT_RUN` so an answer the
 * orchestrator obtained by mistake can never change the outcome.
 *
 * `searchContext` is what the orchestrator showed the classifier beside the chosen listing, kept
 * on the result so a steering rejection can evidence itself (D87). It follows the answer exactly:
 * recorded when the classifier was required, dropped with the answer when it was not.
 */
export function decide(
  ready: Ready,
  policy: Policy,
  classifier: ClassifierAnswer,
  searchContext: string | null = null,
): Decision {
  if (ready.policyVersion !== policy.version) {
    throw new SlipError(
      "POLICY_VERSION_MISMATCH",
      `prepared under policy v${ready.policyVersion}, deciding under v${policy.version}`,
    );
  }

  const effective: ClassifierAnswer = ready.classifierRequired ? classifier : "NOT_RUN";
  const { ruleCode, ruleCodes } = evaluateRules({
    policy,
    chosenPriceCents: ready.chosen.priceCents,
    bestPriceCents: ready.best.priceCents,
    gapAbsCents: ready.gapAbsCents,
    conflict: ready.conflict,
    classifier: effective,
  });

  return {
    outcome: RULE_OUTCOME[ruleCode],
    ruleCode,
    checkResult: {
      policyVersion: ready.policyVersion,
      snapshotId: ready.snapshotId,
      snapshotFetchedAt: ready.snapshotFetchedAt,
      comparableCount: ready.comparableCount,
      chosen: ready.chosen,
      best: ready.best,
      gapAbsCents: ready.gapAbsCents,
      gapPctHundredths: ready.gapPctHundredths,
      conflict: ready.conflict,
      classifier: effective,
      searchContext: ready.classifierRequired ? searchContext : null,
      ruleCodes,
      ruleCode,
    },
  };
}
