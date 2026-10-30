import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SellerEdge } from "./edge.js";
import { propagationNetwork, resolveSellers, sellerCount } from "./resolve.js";
import { directStanding, rankOf, standingByDomain } from "./standing.js";
import type { Tier } from "./tier.js";

/**
 * The invariant of docs/MERCHANTS.md §4.3, as properties rather than as a comment: evidence below
 * Tier A/B may move a decision only toward HOLD. Here that means inference may lower the seller
 * count — which is what `R2B_SINGLE_SELLER_MARKET` reads — and may do nothing else at all.
 */

const NOW = new Date("2026-10-30T12:00:00.000Z");

const arbDomain = fc.nat({ max: 12 }).map((n) => `s${n}.example`);
const arbAttestation = fc.nat({ max: 20 }).map((n) => `att-${n}`);

const arbRooted: fc.Arbitrary<SellerEdge> = fc.record({
  from: arbDomain,
  to: arbDomain,
  tier: fc.constantFrom<Tier>("A", "B"),
  attestationIds: fc.uniqueArray(arbAttestation, { minLength: 1, maxLength: 3 }),
});

const arbInferred: fc.Arbitrary<SellerEdge> = fc.record({
  from: arbDomain,
  to: arbDomain,
  tier: fc.constant<Tier>("C"),
  attestationIds: fc.constant<string[]>([]),
});

const arbDomains = fc.uniqueArray(arbDomain, { minLength: 1, maxLength: 8 });
const arbRootedEdges = fc.array(arbRooted, { maxLength: 8 });
const arbInferredEdges = fc.array(arbInferred, { maxLength: 8 });
const arbTierMap = fc
  .array(fc.tuple(arbDomain, fc.constantFrom<Tier>("A", "B", "C")), { maxLength: 8 })
  .map((pairs) => new Map(pairs));

describe("inference may only make Slip more cautious", () => {
  it("never raises the seller count", () => {
    fc.assert(
      fc.property(arbDomains, arbRootedEdges, arbInferredEdges, (domains, rooted, guesses) => {
        const without = sellerCount(domains, rooted);
        const with_ = sellerCount(domains, [...rooted, ...guesses]);
        expect(with_).toBeLessThanOrEqual(without);
      }),
    );
  });

  it("never changes who a seller is", () => {
    fc.assert(
      fc.property(arbDomains, arbRootedEdges, arbInferredEdges, (domains, rooted, guesses) => {
        expect(resolveSellers(domains, [...rooted, ...guesses]).components).toEqual(
          resolveSellers(domains, rooted).components,
        );
      }),
    );
  });

  it("never changes anyone's standing", () => {
    // True by construction, because `standingByDomain` takes the propagation network rather than
    // the collapse. The property is here so that a later change which passed the collapse instead
    // would fail loudly rather than quietly let a guess carry standing.
    fc.assert(
      fc.property(
        arbDomains,
        arbRootedEdges,
        arbInferredEdges,
        arbTierMap,
        (domains, rooted, guesses, identityTier) => {
          const attested = { identityTier, incidents: new Map() };
          const all = [...rooted, ...guesses];
          expect([
            ...standingByDomain(domains, propagationNetwork(domains, all), attested, NOW),
          ]).toEqual([
            ...standingByDomain(domains, propagationNetwork(domains, rooted), attested, NOW),
          ]);
        },
      ),
    );
  });
});

describe("more evidence of sameness can only merge", () => {
  it("holds for every tier, so a count can only fall as evidence arrives", () => {
    fc.assert(
      fc.property(arbDomains, arbRootedEdges, arbInferredEdges, (domains, rooted, guesses) => {
        const edges = [...rooted, ...guesses];
        let previous = sellerCount(domains, []);
        expect(previous).toBe(new Set(domains).size);
        for (let i = 1; i <= edges.length; i += 1) {
          const now = sellerCount(domains, edges.slice(0, i));
          expect(now).toBeLessThanOrEqual(previous);
          previous = now;
        }
        expect(previous).toBeGreaterThanOrEqual(1);
      }),
    );
  });
});

describe("the one-rank ceiling", () => {
  it("never lets a network lift a storefront more than one rank above its own attestations", () => {
    fc.assert(
      fc.property(arbDomains, arbRootedEdges, arbTierMap, (domains, edges, identityTier) => {
        const standings = standingByDomain(
          domains,
          propagationNetwork(domains, edges),
          { identityTier, incidents: new Map() },
          NOW,
        );
        for (const domain of domains) {
          const got = standings.get(domain);
          expect(got).toBeDefined();
          if (got !== undefined) {
            const ceiling = rankOf(directStanding(identityTier.get(domain) ?? null)) + 1;
            expect(rankOf(got)).toBeLessThanOrEqual(ceiling);
          }
        }
      }),
    );
  });
});

describe("determinism", () => {
  it("resolves the same components whatever order the edges arrive in", () => {
    fc.assert(
      fc.property(arbDomains, arbRootedEdges, (domains, edges) => {
        const forward = resolveSellers(domains, edges);
        const backward = resolveSellers([...domains].reverse(), [...edges].reverse());
        expect(forward.components).toEqual(backward.components);
      }),
    );
  });

  it("sorts every list it hands out, so a stored component compares byte for byte", () => {
    fc.assert(
      fc.property(arbDomains, arbRootedEdges, (domains, edges) => {
        for (const component of resolveSellers(domains, edges).components) {
          expect([...component.domains]).toEqual([...component.domains].sort());
          expect([...component.attestationIds]).toEqual([...component.attestationIds].sort());
          expect(component.id).toBe(component.domains[0]);
        }
      }),
    );
  });
});
