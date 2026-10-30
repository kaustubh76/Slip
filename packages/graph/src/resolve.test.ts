import { describe, expect, it } from "vitest";
import type { SellerEdge } from "./edge.js";
import { collapseSellers, propagationNetwork, resolveSellers, sellerCount } from "./resolve.js";

const rooted = (from: string, to: string, attestationIds: string[] = ["att-1"]): SellerEdge => ({
  from,
  to,
  tier: "A",
  attestationIds,
});

const inferred = (from: string, to: string): SellerEdge => ({
  from,
  to,
  tier: "C",
  attestationIds: [],
});

describe("resolveSellers", () => {
  it("makes a lone domain a seller of one", () => {
    const resolved = resolveSellers(["a.example"], []);
    expect(resolved.componentOf("a.example")).toEqual({
      id: "a.example",
      domains: ["a.example"],
      attestationIds: [],
    });
  });

  it("answers for a domain it was never given, rather than throwing", () => {
    // The check asks about whatever the catalogue returned; an unknown store is a seller of one.
    expect(resolveSellers([], []).componentOf("new.example").domains).toEqual(["new.example"]);
  });

  it("merges on a rooted edge and carries the attestation that justified it", () => {
    const resolved = resolveSellers(
      ["b.example", "a.example"],
      [rooted("b.example", "a.example", ["att-7"])],
    );
    expect(resolved.components).toHaveLength(1);
    expect(resolved.componentOf("b.example")).toEqual({
      id: "a.example",
      domains: ["a.example", "b.example"],
      attestationIds: ["att-7"],
    });
  });

  it("does not merge on inference, however much of it there is", () => {
    const edges = [
      inferred("a.example", "b.example"),
      inferred("b.example", "c.example"),
      inferred("c.example", "a.example"),
    ];
    expect(resolveSellers(["a.example", "b.example", "c.example"], edges).components).toHaveLength(
      3,
    );
  });

  it("names the component after its smallest domain, whatever order the edges arrive in", () => {
    const forward = resolveSellers(
      ["z.example", "m.example", "a.example"],
      [rooted("z.example", "m.example"), rooted("m.example", "a.example")],
    );
    const backward = resolveSellers(
      ["a.example", "m.example", "z.example"],
      [rooted("a.example", "m.example"), rooted("m.example", "z.example")],
    );
    expect(forward.components).toEqual(backward.components);
    expect(forward.componentOf("z.example").id).toBe("a.example");
  });
});

describe("sellerCount", () => {
  it("counts every storefront when nothing links them", () => {
    expect(sellerCount(["a.example", "b.example", "c.example"], [])).toBe(3);
  });

  it("collapses the Sybil market of MERCHANTS.md §2.1 to one seller", () => {
    // The shape the study sample already carries: one seller behind several storefronts, which
    // today clears R2_TOO_FEW_OFFERS and makes its own cheapest listing the market.
    const domains = ["jcpenney.com", "slt-sfcc-react-production.mobify-storefront.com"];
    expect(sellerCount(domains, [])).toBe(2);
    expect(sellerCount(domains, [inferred(domains[0] ?? "", domains[1] ?? "")])).toBe(1);
  });

  it("lets inference lower the count, which is the only thing inference may do", () => {
    const domains = ["a.example", "b.example", "c.example"];
    const collapsed = collapseSellers(domains, [inferred("a.example", "b.example")]);
    expect(collapsed.componentOf("a.example").id).toBe(collapsed.componentOf("b.example").id);
    // ...and the identity resolution over the same edge is untouched.
    expect(resolveSellers(domains, [inferred("a.example", "b.example")]).components).toHaveLength(
      3,
    );
  });

  it("ignores a domain outside the set it was asked about", () => {
    const count = sellerCount(["a.example"], [rooted("b.example", "c.example")]);
    expect(count).toBe(1);
  });
});

describe("propagationNetwork", () => {
  it("joins payout roots and leaves a domain-control proof alone", () => {
    const edges: SellerEdge[] = [
      { from: "a.example", to: "b.example", tier: "A", attestationIds: ["att-1"] },
      { from: "b.example", to: "c.example", tier: "B", attestationIds: ["att-2"] },
    ];
    const network = propagationNetwork(["a.example", "b.example", "c.example"], edges);
    expect(network.componentOf("a.example").domains).toEqual(["a.example", "b.example"]);
    expect(network.componentOf("c.example").domains).toEqual(["c.example"]);
  });
});
