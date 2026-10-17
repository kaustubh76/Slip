import { describe, expect, it } from "vitest";
import { disclosure } from "./disclosure";

describe("the disclosure line", () => {
  it("says the stand-ins are stand-ins", () => {
    const line = disclosure(true);
    expect(line).toMatch(/^Simulated demo:/);
    expect(line).toContain("stores and prices are made up");
    expect(line).not.toContain("PayPal sandbox");
  });

  it("keeps the spec's sentence once PayPal's sandbox is real", () => {
    expect(disclosure(false)).toBe(
      "Demo runs in PayPal sandbox. Slip is the seller. No real money moves; no order reaches a retailer.",
    );
  });

  it("always says who sells and that no money or order is real", () => {
    for (const line of [disclosure(true), disclosure(false)]) {
      expect(line).toContain("Slip is the seller.");
      expect(line).toContain("No real money moves; no order reaches a retailer.");
    }
  });
});
