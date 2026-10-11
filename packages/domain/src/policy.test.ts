import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, MAX_SNAPSHOT_AGE_MS, PolicySchema, policyWith } from "./policy.js";

describe("DEFAULT_POLICY", () => {
  it("matches the spec defaults: 5 % and $8, 1 % flag line, $200 cap, 10-minute snapshots", () => {
    expect(DEFAULT_POLICY).toEqual({
      version: 1,
      maxOverpayPctHundredths: 500,
      maxOverpayAbsCents: 800,
      flagPctHundredths: 100,
      orderCapCents: 20_000,
      snapshotMaxAgeMs: 600_000,
    });
  });
});

describe("PolicySchema", () => {
  it.each([
    ["version 0", { version: 0 }],
    ["fractional version", { version: 1.5 }],
    ["negative percent", { maxOverpayPctHundredths: -1 }],
    ["fractional percent hundredths", { maxOverpayPctHundredths: 50.5 }],
    ["percent above 1000 %", { maxOverpayPctHundredths: 100_001 }],
    ["negative cents", { maxOverpayAbsCents: -1 }],
    ["order cap above $1M", { orderCapCents: 100_000_001 }],
    ["snapshot age above 24 h", { snapshotMaxAgeMs: MAX_SNAPSHOT_AGE_MS + 1 }],
    ["negative snapshot age", { snapshotMaxAgeMs: -1 }],
  ])("rejects %s", (_label, override) => {
    expect(() => PolicySchema.parse({ ...DEFAULT_POLICY, ...override })).toThrow();
  });

  it("accepts the bounds themselves", () => {
    expect(() =>
      PolicySchema.parse({
        ...DEFAULT_POLICY,
        maxOverpayPctHundredths: 0,
        maxOverpayAbsCents: 0,
        flagPctHundredths: 100_000,
        orderCapCents: 100_000_000,
        snapshotMaxAgeMs: MAX_SNAPSHOT_AGE_MS,
      }),
    ).not.toThrow();
  });
});

describe("policyWith", () => {
  it("creates the next version with the change applied and nothing else touched", () => {
    const next = policyWith(DEFAULT_POLICY, { maxOverpayPctHundredths: 750 });
    expect(next.version).toBe(2);
    expect(next.maxOverpayPctHundredths).toBe(750);
    expect(next.maxOverpayAbsCents).toBe(DEFAULT_POLICY.maxOverpayAbsCents);
    expect(DEFAULT_POLICY.version).toBe(1);
  });

  it("validates the change", () => {
    expect(() => policyWith(DEFAULT_POLICY, { orderCapCents: -5 })).toThrow();
  });
});
