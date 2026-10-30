import { SlipError } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { assertEdge } from "./edge.js";
import { isRooted, mayPropagate, TIERS } from "./tier.js";

describe("tiers", () => {
  it("roots A and B, and never C", () => {
    expect(TIERS.filter(isRooted)).toEqual(["A", "B"]);
  });

  it("propagates standing across A alone", () => {
    expect(TIERS.filter(mayPropagate)).toEqual(["A"]);
  });

  it("lets every rooted tier merge, which is strictly more than may propagate", () => {
    // A signed domain-control proof says who runs a site, not who is paid for it: enough to merge,
    // not enough to carry standing to a storefront that attested nothing.
    expect(isRooted("B")).toBe(true);
    expect(mayPropagate("B")).toBe(false);
  });
});

describe("assertEdge", () => {
  it("refuses a rooted edge that cites no attestation", () => {
    expect(() =>
      assertEdge({ from: "a.example", to: "b.example", tier: "A", attestationIds: [] }),
    ).toThrow(SlipError);
  });

  it("refuses an inferred edge that cites one, because it is a mislabelled rooted edge", () => {
    expect(() =>
      assertEdge({ from: "a.example", to: "b.example", tier: "C", attestationIds: ["att-1"] }),
    ).toThrow(SlipError);
  });

  it("accepts the two well-formed shapes", () => {
    expect(() =>
      assertEdge({ from: "a.example", to: "b.example", tier: "A", attestationIds: ["att-1"] }),
    ).not.toThrow();
    expect(() =>
      assertEdge({ from: "a.example", to: "b.example", tier: "C", attestationIds: [] }),
    ).not.toThrow();
  });
});
