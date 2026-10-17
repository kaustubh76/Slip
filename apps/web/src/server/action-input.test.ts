import { describe, expect, it } from "vitest";
import {
  AmountCentsSchema,
  invalidRequest,
  LimitsInputSchema,
  PolicyVersionSchema,
  ReceiptIdSchema,
} from "./action-input";

describe("server action input", () => {
  it("accepts what the pages send", () => {
    expect(AmountCentsSchema.parse(23_900)).toBe(23_900);
    expect(ReceiptIdSchema.parse("8f1c2d4e-0000-4000-8000-000000000001")).toBeTypeOf("string");
    expect(PolicyVersionSchema.parse(3)).toBe(3);
    expect(
      LimitsInputSchema.parse({
        maxOverpayPct: 5,
        maxOverpayDollars: 8,
        flagPct: 1,
        orderCapDollars: 200,
        snapshotMaxAgeMinutes: 10,
      }),
    ).toMatchObject({ maxOverpayPct: 5 });
  });

  it("refuses forged or broken arguments", () => {
    for (const amount of [0, -1, 1.5, Number.NaN, 1e12, "2390" as unknown]) {
      expect(AmountCentsSchema.safeParse(amount).success, String(amount)).toBe(false);
    }
    expect(ReceiptIdSchema.safeParse("").success).toBe(false);
    expect(ReceiptIdSchema.safeParse("x".repeat(65)).success).toBe(false);
    expect(PolicyVersionSchema.safeParse(0).success).toBe(false);
    expect(
      LimitsInputSchema.safeParse({
        maxOverpayPct: Number.NaN,
        maxOverpayDollars: 8,
        flagPct: 1,
        orderCapDollars: 200,
        snapshotMaxAgeMinutes: 10,
      }).success,
    ).toBe(false);
    expect(
      LimitsInputSchema.safeParse({
        maxOverpayPct: 5,
        maxOverpayDollars: 8,
        flagPct: 1,
        orderCapDollars: 200,
        snapshotMaxAgeMinutes: 10,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("a bad input is a refusal the dialog can show", () => {
    expect(invalidRequest("amount")).toEqual({
      status: "refused",
      reason: "INVALID_REQUEST",
      message: "That request was not understood (amount).",
    });
  });
});
