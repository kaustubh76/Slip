import { assertEdge, type SellerEdge } from "./edge.js";
import { ALL_TIERS, PROPAGATING_TIERS, ROOTED_TIERS, type Tier } from "./tier.js";

/** One seller: the storefronts the chosen tiers merged, and the attestations that justified it. */
export interface SellerComponent {
  /** The lexicographically smallest domain in the component, so the id never depends on order. */
  readonly id: string;
  readonly domains: readonly string[];
  /** Every attestation that justified a merge inside this component, sorted. */
  readonly attestationIds: readonly string[];
}

export interface Resolution {
  /** Every component, by id. */
  readonly components: readonly SellerComponent[];
  /** The component a domain belongs to. A domain nothing merged is a seller of one. */
  componentOf(domain: string): SellerComponent;
}

/**
 * Union-find over the edges of the given tiers, carrying each merge's provenance.
 *
 * Deterministic twice over, because a decision must replay exactly (D22): the smaller domain
 * always becomes the root, and every list comes out sorted, so neither the seller id nor the
 * component's contents can depend on the order the edges arrived in.
 */
export function resolveBy(
  domains: readonly string[],
  edges: readonly SellerEdge[],
  tiers: readonly Tier[],
): Resolution {
  const parent = new Map<string, string>();

  function seed(domain: string): void {
    if (!parent.has(domain)) {
      parent.set(domain, domain);
    }
  }

  function root(domain: string): string {
    let current = domain;
    for (;;) {
      const next = parent.get(current);
      if (next === undefined || next === current) {
        return current;
      }
      current = next;
    }
  }

  for (const edge of edges) {
    assertEdge(edge);
  }
  for (const domain of domains) {
    seed(domain);
  }

  // Only the chosen tiers put a domain on the graph at all. An edge this resolution ignores must
  // leave no trace in it, or a Tier C guess would add a singleton to the identity resolution and
  // inference would be visible where it has no business being.
  const merged: SellerEdge[] = [];
  for (const edge of edges) {
    if (!tiers.includes(edge.tier)) {
      continue;
    }
    seed(edge.from);
    seed(edge.to);
    merged.push(edge);
    const a = root(edge.from);
    const b = root(edge.to);
    if (a !== b) {
      const [keep, drop] = a < b ? [a, b] : [b, a];
      parent.set(drop, keep);
    }
  }

  const groups = new Map<string, { domains: string[]; attestationIds: Set<string> }>();
  function groupAt(id: string): { domains: string[]; attestationIds: Set<string> } {
    const existing = groups.get(id);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = { domains: [], attestationIds: new Set<string>() };
    groups.set(id, fresh);
    return fresh;
  }

  for (const domain of parent.keys()) {
    groupAt(root(domain)).domains.push(domain);
  }
  for (const edge of merged) {
    const group = groupAt(root(edge.from));
    for (const id of edge.attestationIds) {
      group.attestationIds.add(id);
    }
  }

  const components: SellerComponent[] = [...groups.entries()]
    .map(([id, group]) => ({
      id,
      domains: [...group.domains].sort(),
      attestationIds: [...group.attestationIds].sort(),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const index = new Map<string, SellerComponent>();
  for (const component of components) {
    for (const domain of component.domains) {
      index.set(domain, component);
    }
  }

  return {
    components,
    componentOf(domain) {
      return index.get(domain) ?? { id: domain, domains: [domain], attestationIds: [] };
    },
  };
}

/**
 * Identity. Only attested edges merge, so a component is a seller something can be held to and
 * whose standing may be spoken for.
 */
export function resolveSellers(
  domains: readonly string[],
  edges: readonly SellerEdge[],
): Resolution {
  return resolveBy(domains, edges, ROOTED_TIERS);
}

/**
 * The collapse used to count sellers, inference included.
 *
 * This is the only place a Tier C edge does anything, and all it can do is lower a count — which
 * can only hold a purchase. It must never reach `best` or the gap: removing a ring's cheapest
 * listing would make `best` dearer, the gap smaller, and could turn an overpayment rejection into
 * a payment (docs/MERCHANTS.md §4.4).
 */
export function collapseSellers(
  domains: readonly string[],
  edges: readonly SellerEdge[],
): Resolution {
  return resolveBy(domains, edges, ALL_TIERS);
}

/** The network standing may travel across: payout roots only. */
export function propagationNetwork(
  domains: readonly string[],
  edges: readonly SellerEdge[],
): Resolution {
  return resolveBy(domains, edges, PROPAGATING_TIERS);
}

/**
 * How many distinct sellers are behind these storefronts. `R2B_SINGLE_SELLER_MARKET` is this
 * being fewer than two.
 */
export function sellerCount(domains: readonly string[], edges: readonly SellerEdge[]): number {
  const collapsed = collapseSellers(domains, edges);
  const seen = new Set<string>();
  for (const domain of domains) {
    seen.add(collapsed.componentOf(domain).id);
  }
  return seen.size;
}
