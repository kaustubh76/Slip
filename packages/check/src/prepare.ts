import {
  type Cents,
  type CheckoutRequest,
  type Decision,
  gapExceedsPct,
  type Offer,
  type OfferSnapshot,
  type Policy,
  type PolicyVersion,
  RULE_OUTCOME,
  type RuleCode,
  SlipError,
  type SnapshotId,
} from "@slip/domain";
import { type ComparableOffer, dedupeByNormalizedUrl, isComparable } from "./comparable.js";
import { computeGap, hasConflict, pickBest } from "./compute.js";
import { isSnapshotFresh } from "./freshness.js";
import { locateChosen, type MatchedBy } from "./locate.js";
import { variantMatches } from "./variant.js";

export interface PrepareInput {
  /** `null` when no snapshot could be fetched at all (Channel3 down, out of credits, 404). */
  snapshot: OfferSnapshot | null;
  request: CheckoutRequest;
  policy: Policy;
  /** Passed in, never read from the clock, so decisions replay exactly. */
  now: Date;
}

/** Everything is in place to run rules R3–R7; the classifier may still be needed. */
export interface Ready {
  kind: "ready";
  policyVersion: PolicyVersion;
  snapshotId: SnapshotId;
  snapshotFetchedAt: Date;
  chosen: ComparableOffer;
  best: ComparableOffer;
  matchedBy: MatchedBy;
  /** Comparable offers including the chosen one, after URL dedupe. Always ≥ 2 here. */
  comparableCount: number;
  gapAbsCents: Cents;
  gapPctHundredths: number;
  conflict: boolean;
  /** True when the gap is above the flag line, so the orchestrator must ask the classifier. */
  classifierRequired: boolean;
}

/** The check ended before the rules: the decision is final and carries its own CheckResult. */
export interface Stopped {
  kind: "rejected" | "held";
  decision: Decision;
}

export type Prepared = Ready | Stopped;

interface StopDetail {
  snapshot: OfferSnapshot | null;
  chosen: Offer | null;
  best: Offer | null;
  comparableCount: number;
}

function stop(code: RuleCode, policy: Policy, detail: StopDetail): Stopped {
  const outcome = RULE_OUTCOME[code];
  if (outcome === "PAID") {
    throw new SlipError("INVALID_STOP", `${code} cannot end a check early`);
  }
  return {
    kind: outcome === "REJECTED" ? "rejected" : "held",
    decision: {
      outcome,
      ruleCode: code,
      checkResult: {
        policyVersion: policy.version,
        snapshotId: detail.snapshot?.id ?? null,
        snapshotFetchedAt: detail.snapshot?.fetchedAt ?? null,
        comparableCount: detail.comparableCount,
        chosen: detail.chosen,
        best: detail.best,
        gapAbsCents: null,
        gapPctHundredths: null,
        conflict: false,
        classifier: "NOT_RUN",
        ruleCodes: [code],
        ruleCode: code,
      },
    },
  };
}

/**
 * Phase one of the check: steps 1–6 of the rule order. Pure. Returns either a final decision
 * (nothing to compare, or the chosen offer cannot be paid for) or a `Ready` for `decide`.
 *
 * Order: R1 stale/missing snapshot → variant mismatch → offer not found → chosen unavailable →
 * chosen unverified → R2 too few offers → ready.
 */
export function prepareCheck(input: PrepareInput): Prepared {
  const { snapshot, request, policy, now } = input;

  if (snapshot === null || !isSnapshotFresh(snapshot, policy, now)) {
    return stop("R1_STALE_SNAPSHOT", policy, {
      snapshot,
      chosen: null,
      best: null,
      comparableCount: 0,
    });
  }

  const offers = dedupeByNormalizedUrl(snapshot.offers);
  const comparable = offers.filter(isComparable);
  const best = pickBest(comparable);
  const common = { snapshot, best, comparableCount: comparable.length };

  if (!variantMatches(request.selectedOptions, snapshot.selectedOptions)) {
    return stop("VARIANT_MISMATCH", policy, { ...common, chosen: null });
  }

  const located = locateChosen(offers, request.chosenOfferUrl);
  if (located === null) {
    return stop("OFFER_NOT_FOUND", policy, { ...common, chosen: null });
  }
  const chosen = located.offer;

  if (chosen.availability === "OutOfStock" || chosen.condition === "used") {
    return stop("CHOSEN_UNAVAILABLE", policy, { ...common, chosen });
  }
  if (!isComparable(chosen)) {
    return stop("CHOSEN_UNVERIFIED", policy, { ...common, chosen });
  }
  if (best === null || comparable.length < 2) {
    return stop("R2_TOO_FEW_OFFERS", policy, { ...common, chosen });
  }

  const { gapAbsCents, gapPctHundredths } = computeGap(chosen, best);

  return {
    kind: "ready",
    policyVersion: policy.version,
    snapshotId: snapshot.id,
    snapshotFetchedAt: snapshot.fetchedAt,
    chosen,
    best,
    matchedBy: located.matchedBy,
    comparableCount: comparable.length,
    gapAbsCents,
    gapPctHundredths,
    conflict: hasConflict(chosen, best, gapAbsCents),
    classifierRequired: gapExceedsPct(gapAbsCents, best.priceCents, policy.flagPctHundredths),
  };
}
