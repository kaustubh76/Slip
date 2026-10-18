import { describe, expect, it } from "vitest";
import { disclosure } from "./disclosure";
import type { Services } from "./services";

const all = (over: Partial<Services> = {}): Services => ({
  prices: "simulated",
  payment: "simulated",
  steering: "simulated",
  ...over,
});

describe("the disclosure line", () => {
  it("says the stand-ins are stand-ins", () => {
    const line = disclosure(all());
    expect(line).toContain("stand-ins made up in this server");
    expect(line).toContain("PayPal is a stand-in");
    expect(line).toContain("no real money moves");
  });

  it("does not call real Channel3 prices simulated", () => {
    // The mixed state is the likely one: a price key costs nothing, a sandbox buyer takes work.
    const line = disclosure(all({ prices: "channel3" }));
    expect(line).toContain("Prices are real listings from Channel3.");
    expect(line).not.toContain("made up");
    expect(line).toContain("PayPal is a stand-in");
  });

  it("does not call a stand-in payment a sandbox one", () => {
    expect(disclosure(all({ payment: "sandbox" }))).toContain("PayPal's sandbox");
    expect(disclosure(all({ payment: "simulated" }))).not.toContain("sandbox");
  });

  it("says plainly when money is real", () => {
    const line = disclosure(all({ prices: "channel3", payment: "live" }));
    expect(line).toContain("real money moves");
    expect(line).not.toContain("no real money moves");
  });

  it("never claims nobody is paid, and always names the seller", () => {
    for (const services of [
      all(),
      all({ prices: "channel3" }),
      all({ payment: "sandbox" }),
      all({ payment: "live" }),
    ]) {
      const line = disclosure(services);
      expect(line).toContain("Slip is the seller");
      expect(line).toContain("no order reaches a retailer");
    }
  });
});
