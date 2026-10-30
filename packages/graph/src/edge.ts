import { SlipError } from "@slip/domain";
import { isRooted, type Tier } from "./tier.js";

/**
 * One claim that two storefronts are the same seller. Direction carries no meaning: resolution
 * treats every edge as symmetric, and the canonical seller id is derived from the domains rather
 * than from whichever end was written first.
 */
export interface SellerEdge {
  readonly from: string;
  readonly to: string;
  readonly tier: Tier;
  /**
   * The attestations that justified it, and empty for inference. A rooted edge with no attestation
   * would be a merge nobody can be held to, and an inferred edge that cites one is a mislabelled
   * rooted edge; both are refused here rather than trusted, and the database refuses them too
   * (docs/MERCHANTS.md §4.6).
   */
  readonly attestationIds: readonly string[];
}

export function assertEdge(edge: SellerEdge): void {
  const cited = edge.attestationIds.length;
  if (isRooted(edge.tier) && cited === 0) {
    throw new SlipError(
      "UNROOTED_MERGE",
      `tier ${edge.tier} edge ${edge.from} → ${edge.to} cites no attestation`,
    );
  }
  if (!isRooted(edge.tier) && cited > 0) {
    throw new SlipError(
      "MISLABELLED_EDGE",
      `tier ${edge.tier} edge ${edge.from} → ${edge.to} cites ${cited}; it would be rooted`,
    );
  }
}
