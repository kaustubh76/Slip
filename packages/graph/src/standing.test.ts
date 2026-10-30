import { describe, expect, it } from "vitest";
import type { SellerEdge } from "./edge.js";
import { propagationNetwork } from "./resolve.js";
import {
  atLeast,
  DEFAULT_INCIDENT_WINDOW_MS,
  directStanding,
  type Incident,
  openIncidents,
  standingByDomain,
  standingOf,
} from "./standing.js";
import type { Tier } from "./tier.js";

const NOW = new Date("2026-10-30T12:00:00.000Z");

describe("directStanding", () => {
  it("is worth most for a payout root and nothing for inference", () => {
    expect(directStanding("A")).toBe("VERIFIED");
    expect(directStanding("B")).toBe("DECLARED");
    expect(directStanding("C")).toBe("NONE");
    expect(directStanding(null)).toBe("NONE");
  });
});

describe("atLeast", () => {
  it("compares as an ordinal, so an owner's floor is one check", () => {
    expect(atLeast("VERIFIED", "DECLARED")).toBe(true);
    expect(atLeast("DECLARED", "DECLARED")).toBe(true);
    expect(atLeast("NONE", "DECLARED")).toBe(false);
    expect(atLeast("NONE", "NONE")).toBe(true);
  });
});

describe("openIncidents", () => {
  const incident = (daysAgo: number): Incident => ({
    kind: "STEERED",
    at: new Date(NOW.getTime() - daysAgo * 24 * 60 * 60 * 1000),
  });

  it("counts what is inside the window and forgets what is not", () => {
    expect(openIncidents([incident(1), incident(29), incident(31)], NOW)).toBe(2);
  });

  it("drops an incident exactly at the window's edge", () => {
    const at = new Date(NOW.getTime() - DEFAULT_INCIDENT_WINDOW_MS);
    expect(openIncidents([{ kind: "STEERED", at }], NOW)).toBe(0);
  });
});

describe("standingOf", () => {
  it("takes a storefront's own attestations at face value", () => {
    expect(standingOf({ direct: "VERIFIED", propagated: "NONE", openIncidents: 0 })).toBe(
      "VERIFIED",
    );
  });

  it("lifts an unattested storefront one rank for the root it is bound into, and no further", () => {
    // The Sybil rule: rooting one domain properly must not speak for every domain behind it.
    expect(standingOf({ direct: "NONE", propagated: "VERIFIED", openIncidents: 0 })).toBe(
      "DECLARED",
    );
  });

  it("lowers one rank per open incident, and stops at NONE", () => {
    expect(standingOf({ direct: "VERIFIED", propagated: "VERIFIED", openIncidents: 1 })).toBe(
      "DECLARED",
    );
    expect(standingOf({ direct: "VERIFIED", propagated: "VERIFIED", openIncidents: 9 })).toBe(
      "NONE",
    );
  });
});

describe("standingByDomain", () => {
  const attested = (pairs: [string, Tier][]): Map<string, Tier> => new Map(pairs);

  it("does not launder standing to the rest of a network", () => {
    // One verified domain, two unattested ones bound to it by payout. The two reach DECLARED and
    // stop; only the domain that attested is VERIFIED.
    const domains = ["clean.example", "shell-1.example", "shell-2.example"];
    const edges: SellerEdge[] = [
      { from: "clean.example", to: "shell-1.example", tier: "A", attestationIds: ["att-1"] },
      { from: "clean.example", to: "shell-2.example", tier: "A", attestationIds: ["att-1"] },
    ];
    const standings = standingByDomain(
      domains,
      propagationNetwork(domains, edges),
      { identityTier: attested([["clean.example", "A"]]), incidents: new Map() },
      NOW,
    );
    expect(standings.get("clean.example")).toBe("VERIFIED");
    expect(standings.get("shell-1.example")).toBe("DECLARED");
    expect(standings.get("shell-2.example")).toBe("DECLARED");
  });

  it("charges an incident to the storefront that earned it, not to its network", () => {
    const domains = ["a.example", "b.example"];
    const edges: SellerEdge[] = [
      { from: "a.example", to: "b.example", tier: "A", attestationIds: ["att-1"] },
    ];
    const standings = standingByDomain(
      domains,
      propagationNetwork(domains, edges),
      {
        identityTier: attested([
          ["a.example", "A"],
          ["b.example", "A"],
        ]),
        incidents: new Map([["b.example", [{ kind: "STEERED", at: NOW } as Incident]]]),
      },
      NOW,
    );
    expect(standings.get("a.example")).toBe("VERIFIED");
    expect(standings.get("b.example")).toBe("DECLARED");
  });
});
