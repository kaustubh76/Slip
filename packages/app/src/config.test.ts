import { describe, expect, it } from "vitest";
import { appConfig } from "./config.js";

describe("appConfig", () => {
  it("defaults follow the spec and the decision log", () => {
    expect(appConfig()).toMatchObject({
      leaseTtlMs: 60_000,
      offersTimeoutMs: 5_000,
      classifierTimeoutMs: 5_000,
      paypalTimeoutMs: 15_000,
      dedupeWindowMs: 600_000,
      retryWindowMs: 3_600_000,
      maxAttemptsPerRetryWindow: 4,
      holdTtlMs: 48 * 3_600_000,
      orderResendWindowMs: 30 * 60_000,
      reportingLagMs: 3 * 3_600_000,
      orderGiveUpMs: 24 * 3_600_000,
      pricesSource: "channel3",
    });
  });

  it("refuses a lease that would expire before the calls it protects", () => {
    expect(() => appConfig({ leaseTtlMs: 20_000 })).toThrow(/leaseTtlMs must outlast/);
    expect(() => appConfig({ leaseTtlMs: 26_000 })).not.toThrow();
  });

  it("refuses giving up on a setup before it is ever polled", () => {
    expect(() =>
      appConfig({ setupPollAfterMs: 3_600_000, setupAbandonAfterMs: 3_600_000 }),
    ).toThrow(/setupAbandonAfterMs/);
    expect(appConfig().setupAbandonAfterMs).toBe(72 * 3_600_000);
  });

  it("refuses nonsense", () => {
    expect(() => appConfig({ paypalTimeoutMs: 0 })).toThrow();
    expect(() => appConfig({ publicBaseUrl: "not a url" })).toThrow();
  });
});
