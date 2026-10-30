import { describe, expect, it } from "vitest";
import { inferSellerEdges } from "./infer.js";
import { sellerCount } from "./resolve.js";

describe("inferSellerEdges", () => {
  it("joins a storefront to the domain it sits under", () => {
    expect(inferSellerEdges(["shop.example.com", "example.com"])).toEqual([
      { from: "example.com", to: "shop.example.com", tier: "C", attestationIds: [] },
    ]);
  });

  it("leaves two honest retailers at the same price alone", () => {
    // The study sample has exactly this: one skillet, two stores, 0% apart. Collapsing them would
    // hold an honest purchase for want of a market that is really there.
    const domains = ["surlatable.com", "williams-sonoma.com"];
    expect(inferSellerEdges(domains)).toEqual([]);
    expect(sellerCount(domains, inferSellerEdges(domains))).toBe(2);
  });

  it("leaves sibling subdomains apart, because two tenants are not one seller", () => {
    const domains = ["a.mobify-storefront.com", "b.mobify-storefront.com"];
    expect(inferSellerEdges(domains)).toEqual([]);
    expect(sellerCount(domains, inferSellerEdges(domains))).toBe(2);
  });

  it("leaves a brand label shared across country domains alone", () => {
    expect(inferSellerEdges(["garvee.com", "garvee.ca"])).toEqual([]);
  });

  it("needs no edge for the same domain listed twice", () => {
    expect(inferSellerEdges(["cos.com", "cos.com"])).toEqual([]);
    expect(sellerCount(["cos.com", "cos.com"], [])).toBe(1);
  });

  it("collapses a whole storefront tree to one seller", () => {
    const domains = ["example.com", "shop.example.com", "eu.shop.example.com"];
    expect(sellerCount(domains, inferSellerEdges(domains))).toBe(1);
  });

  it("is deterministic, whatever order the domains arrive in", () => {
    const forward = inferSellerEdges(["shop.example.com", "example.com", "other.example"]);
    const backward = inferSellerEdges(["other.example", "example.com", "shop.example.com"]);
    expect(forward).toEqual(backward);
  });
});
