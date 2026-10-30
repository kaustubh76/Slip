import { SlipError } from "@slip/domain";
import type { Resolution } from "./resolve.js";
import type { Tier } from "./tier.js";

/**
 * A seller's standing. Ordinal, and three names rather than a score: an owner sets a floor against
 * it and a receipt prints it, and a number would invite reading the mechanism as a ranking that
 * merchants pay into, which is the one thing it must never be (docs/MERCHANTS.md §3.4).
 */
export const STANDINGS = ["NONE", "DECLARED", "VERIFIED"] as const;
export type Standing = (typeof STANDINGS)[number];

export function rankOf(standing: Standing): number {
  return STANDINGS.indexOf(standing);
}

/** The standing at a rank, clamped to the ends. */
export function standingAt(rank: number): Standing {
  const clamped = Math.min(Math.max(rank, 0), STANDINGS.length - 1);
  const standing = STANDINGS[clamped];
  if (standing === undefined) {
    // Unreachable: clamped is an index into STANDINGS. Kept so the type system needs no assertion.
    throw new SlipError("STANDING_RANK", `rank ${rank} is outside the standings`);
  }
  return standing;
}

/** Whether a seller meets the owner's floor. */
export function atLeast(standing: Standing, floor: Standing): boolean {
  return rankOf(standing) >= rankOf(floor);
}

/** The most a storefront's own identity attestation can be worth, by the tier it rests on. */
export function directStanding(tier: Tier | null): Standing {
  if (tier === "A") {
    return "VERIFIED";
  }
  if (tier === "B") {
    return "DECLARED";
  }
  return "NONE";
}

export const INCIDENT_KINDS = ["STEERED", "PRICE_BINDING_BROKEN", "IDENTITY_CONTRADICTED"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export interface Incident {
  readonly kind: IncidentKind;
  readonly at: Date;
}

/** 30 days. */
export const DEFAULT_INCIDENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Incidents count against standing for a fixed window, then stop counting.
 *
 * A window rather than a half-life, because a receipt has to be able to say why it held: "one
 * incident, until 29 November" is checkable by the owner and by the merchant, and a decayed
 * fraction is neither. `now` is passed in and never read from a clock, so the count replays (D22).
 */
export function openIncidents(
  incidents: readonly Incident[],
  now: Date,
  windowMs: number = DEFAULT_INCIDENT_WINDOW_MS,
): number {
  return incidents.filter((incident) => now.getTime() - incident.at.getTime() < windowMs).length;
}

export interface StandingInput {
  /** What this storefront's own attestations support. */
  readonly direct: Standing;
  /** The best standing reachable across payout-rooted edges from a storefront that attested. */
  readonly propagated: Standing;
  /** Incidents still inside their window. */
  readonly openIncidents: number;
}

/**
 * One storefront's standing: its own attestations, lifted by at most one rank for the payout root
 * it is bound into, then lowered one rank per open incident.
 *
 * **The one-rank ceiling is the Sybil rule.** A seller that roots one domain properly cannot
 * thereby speak for every other domain it operates: an unattested storefront inside a verified
 * network reaches DECLARED and stops there (docs/MERCHANTS.md §4.5).
 */
export function standingOf(input: StandingInput): Standing {
  const direct = rankOf(input.direct);
  const lifted = Math.min(Math.max(direct, rankOf(input.propagated)), direct + 1);
  return standingAt(lifted - input.openIncidents);
}

/** What each storefront attested for itself, and what has gone wrong since. */
export interface Attestations {
  /** The best tier of identity attestation the storefront made for itself. */
  readonly identityTier: ReadonlyMap<string, Tier>;
  readonly incidents: ReadonlyMap<string, readonly Incident[]>;
}

/**
 * Standing for each storefront, given the network standing may travel across. `network` must come
 * from `propagationNetwork`: passing the full collapse would let inference carry standing, which
 * is the one thing Tier C may never do.
 */
export function standingByDomain(
  domains: readonly string[],
  network: Resolution,
  attested: Attestations,
  now: Date,
  windowMs: number = DEFAULT_INCIDENT_WINDOW_MS,
): ReadonlyMap<string, Standing> {
  const standings = new Map<string, Standing>();
  for (const domain of domains) {
    const direct = directStanding(attested.identityTier.get(domain) ?? null);
    let propagated = direct;
    for (const peer of network.componentOf(domain).domains) {
      const peerDirect = directStanding(attested.identityTier.get(peer) ?? null);
      if (rankOf(peerDirect) > rankOf(propagated)) {
        propagated = peerDirect;
      }
    }
    standings.set(
      domain,
      standingOf({
        direct,
        propagated,
        openIncidents: openIncidents(attested.incidents.get(domain) ?? [], now, windowMs),
      }),
    );
  }
  return standings;
}
