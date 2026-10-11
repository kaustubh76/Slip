export {
  type ComparableOffer,
  comparableOffers,
  dedupeByNormalizedUrl,
  isComparable,
} from "./comparable.js";
export { compareOffers, computeGap, type Gap, hasConflict, pickBest } from "./compute.js";
export { decide } from "./decide.js";
export { isSnapshotFresh, snapshotAgeMs } from "./freshness.js";
export { type Located, locateChosen, type MatchedBy, offerDomain } from "./locate.js";
export {
  type Prepared,
  type PrepareInput,
  prepareCheck,
  type Ready,
  type Stopped,
} from "./prepare.js";
export { DECISION_RULES, evaluateRules, type RuleContext, type RuleEvaluation } from "./rules.js";
export { domainOf, normalizeDomain, normalizeOfferUrl } from "./url.js";
export { variantMatches } from "./variant.js";
