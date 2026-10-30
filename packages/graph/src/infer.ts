import type { SellerEdge } from "./edge.js";

function isSubdomainOf(child: string, parent: string): boolean {
  return child.length > parent.length && child.endsWith(`.${parent}`);
}

/**
 * The seller edges that can be read off a set of storefront domains alone — no attestation, no
 * store, nothing but the names the catalogue gave. Tier C, and deliberately only the one case a
 * guess cannot get wrong: two domains are joined when one is a subdomain of the other, because
 * `shop.example.com` and `example.com` are one organisation.
 *
 * **Everything wider was left out on purpose.** "Same price and same rate" would collapse two
 * honest retailers at one recommended price, which the study sample shows happening — Sur La Table
 * and Williams Sonoma list the same skillet at the same price, 0% apart. A bare brand label shared
 * across country TLDs is a guess about who owns what. And "same platform host" cannot be told from
 * a public suffix without a list of them: sibling subdomains are two tenants, not one seller, and
 * they are left apart here for exactly that reason.
 *
 * Tier C can only hold a purchase (docs/MERCHANTS.md §4.3), but holding an honest one is still a
 * cost someone pays, so the inference stops where certainty does. The rest needs an attestation.
 */
export function inferSellerEdges(domains: readonly string[]): SellerEdge[] {
  const unique = [...new Set(domains)].sort();
  const edges: SellerEdge[] = [];
  for (let i = 0; i < unique.length; i += 1) {
    for (let j = i + 1; j < unique.length; j += 1) {
      const a = unique[i];
      const b = unique[j];
      if (a === undefined || b === undefined) {
        continue;
      }
      if (isSubdomainOf(a, b) || isSubdomainOf(b, a)) {
        edges.push({ from: a, to: b, tier: "C", attestationIds: [] });
      }
    }
  }
  return edges;
}
