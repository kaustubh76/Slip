import { appConfig } from "@slip/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_TIMING, demoConfig, demoLatencyMs, every } from "./timing";

describe("demo timing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a PayPal call outlasts the page's poll, and the resolver outwaits the call's deadline", () => {
    expect(DEMO_TIMING.latencyMs).toBeGreaterThan(1_000 + 900);
    expect(DEMO_TIMING.latencyMs).toBeLessThan(DEMO_TIMING.paypalTimeoutMs);
    expect(DEMO_TIMING.resolverMinAgeMs).toBeGreaterThan(DEMO_TIMING.paypalTimeoutMs);
    // The application accepts these timings.
    expect(appConfig(demoConfig())).toMatchObject({
      paypalTimeoutMs: 4_000,
      resolverMinAgeMs: 5_000,
    });
  });

  it("reads SLIP_DEMO_LATENCY_MS, falling back to the default on nonsense", () => {
    expect(demoLatencyMs(undefined)).toBe(2_000);
    expect(demoLatencyMs("0")).toBe(0);
    expect(demoLatencyMs("300")).toBe(300);
    expect(demoLatencyMs("-5")).toBe(2_000);
    expect(demoLatencyMs("soon")).toBe(2_000);
  });

  it("runs one tick at a time, again after each, and keeps going after a failure", async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    let runs = 0;
    const stop = every(
      5_000,
      async () => {
        runs += 1;
        if (runs === 2) {
          throw new Error("boom");
        }
      },
      (error) => errors.push(error),
    );
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs).toBe(2);
    expect(errors).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(runs).toBe(3);
    stop();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(runs).toBe(3);
  });
});
