/**
 * Evidence tiers. Every edge in the seller graph carries the kind of evidence that justified it,
 * and the tier is what decides the edge's powers (docs/MERCHANTS.md §4.2):
 *
 * - `A` **binding** — a shared payout account, named by an issuer that knows who the merchant is.
 * - `B` **corroborating** — a signed domain-control proof and a matching legal name.
 * - `C` **suggestive** — a shared platform host, or an identical price and rate across domains.
 */
export const TIERS = ["A", "B", "C"] as const;
export type Tier = (typeof TIERS)[number];

/** Every tier, for the collapse that counts sellers. */
export const ALL_TIERS: readonly Tier[] = TIERS;

/** The tiers that rest on an attestation. */
export const ROOTED_TIERS: readonly Tier[] = ["A", "B"];

/** The tiers standing may travel across. */
export const PROPAGATING_TIERS: readonly Tier[] = ["A"];

/**
 * True when the edge rests on an attestation rather than on inference.
 *
 * Only a rooted edge may establish identity or widen a comparison, because both of those can move
 * a decision away from HOLD — a widened comparison can reject — and a guess must not do that in
 * either direction (docs/MERCHANTS.md §4.3, and D68 for the same reasoning about a suspect gap).
 */
export function isRooted(tier: Tier): boolean {
  return tier !== "C";
}

/**
 * Whether standing may travel *across* this edge to a storefront that attested nothing itself.
 *
 * Only a payout root carries it. Domains are cheap to register, and a signed domain-control proof
 * says who runs a site rather than who is paid for it, so propagating along `B` would let one
 * verified domain speak for a network of them.
 */
export function mayPropagate(tier: Tier): boolean {
  return tier === "A";
}
