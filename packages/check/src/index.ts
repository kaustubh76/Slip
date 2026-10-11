export {
  type ComparableOffer,
  comparableOffers,
  dedupeByNormalizedUrl,
  isComparable,
} from "./comparable.js";
export { isSnapshotFresh, snapshotAgeMs } from "./freshness.js";
export { type Located, locateChosen, type MatchedBy, offerDomain } from "./locate.js";
export { domainOf, normalizeDomain, normalizeOfferUrl } from "./url.js";
export { variantMatches } from "./variant.js";
