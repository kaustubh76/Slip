import { describe, expect, it } from "vitest";
import { InvalidMoneyError } from "./errors.js";
import {
  cents,
  commissionToBps,
  formatPct,
  formatUsd,
  gapExceedsPct,
  gapPctHundredthsFloor,
  MAX_PRICE_CENTS,
  parseUsdNumberToCents,
  parseUsdStringToCents,
  pctHundredths,
} from "./money.js";

describe("parseUsdNumberToCents (Channel3 JSON floats)", () => {
  it.each([
    [0.01, 1],
    [0.29, 29],
    [1.15, 115],
    [4.35, 435],
    [47.99, 4799],
    [129.99, 12999],
    [200, 20000],
    [1_000_000, MAX_PRICE_CENTS],
  ])("parses %s to %s cents exactly", (input, expected) => {
    expect(parseUsdNumberToCents(input)).toBe(expected);
  });

  it.each([
    ["three decimals", 1.005],
    ["three decimals, large", 12.345],
    ["zero", 0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["above the cap", 1_000_000.01],
    ["astronomical", 1e21],
  ])("rejects %s", (_label, input) => {
    expect(() => parseUsdNumberToCents(input)).toThrow(InvalidMoneyError);
  });
});

describe("parseUsdStringToCents (owner-entered limits)", () => {
  it.each([
    ["47.99", 4799],
    ["$47.99", 4799],
    ["1,000", 100000],
    ["$1,000.50", 100050],
    ["0", 0],
    ["8", 800],
    [" 200 ", 20000],
    ["0.5", 50],
  ])("parses %s to %s cents", (input, expected) => {
    expect(parseUsdStringToCents(input)).toBe(expected);
  });

  it.each([["47.999"], ["-1"], ["abc"], [""], ["1e3"], ["12,34"], ["9999999999"]])(
    "rejects %s",
    (input) => {
      expect(() => parseUsdStringToCents(input)).toThrow(InvalidMoneyError);
    },
  );
});

describe("cents / pctHundredths constructors", () => {
  it("accept integers inside their ranges", () => {
    expect(cents(0)).toBe(0);
    expect(cents(MAX_PRICE_CENTS)).toBe(MAX_PRICE_CENTS);
    expect(pctHundredths(500)).toBe(500);
  });

  it.each([[-1], [1.5], [MAX_PRICE_CENTS + 1], [Number.NaN]])("cents rejects %s", (input) => {
    expect(() => cents(input)).toThrow(InvalidMoneyError);
  });

  it.each([[-1], [0.5], [100_001]])("pctHundredths rejects %s", (input) => {
    expect(() => pctHundredths(input)).toThrow(InvalidMoneyError);
  });
});

describe("gapExceedsPct (strict, integer maths)", () => {
  const pct5 = pctHundredths(500);
  const pct1 = pctHundredths(100);

  it("exactly 5 % does not exceed 5 %", () => {
    expect(gapExceedsPct(cents(500), cents(10_000), pct5)).toBe(false);
  });

  it("one cent above 5 % exceeds 5 %", () => {
    expect(gapExceedsPct(cents(501), cents(10_000), pct5)).toBe(true);
  });

  it("works at odd bases where division would be inexact", () => {
    // 1 % of 3333 is 33.33 cents: a 33-cent gap is under, a 34-cent gap is over.
    expect(gapExceedsPct(cents(33), cents(3333), pct1)).toBe(false);
    expect(gapExceedsPct(cents(34), cents(3333), pct1)).toBe(true);
  });

  it("a zero gap never exceeds any threshold, even zero", () => {
    expect(gapExceedsPct(cents(0), cents(1), pctHundredths(0))).toBe(false);
  });

  it("a positive gap exceeds a zero threshold", () => {
    expect(gapExceedsPct(cents(1), cents(100_000), pctHundredths(0))).toBe(true);
  });

  it("stays exact at the caps", () => {
    const max = cents(MAX_PRICE_CENTS);
    expect(gapExceedsPct(max, max, pctHundredths(10_000))).toBe(false);
    expect(gapExceedsPct(max, max, pctHundredths(9_999))).toBe(true);
  });

  it("rejects a non-positive base", () => {
    expect(() => gapExceedsPct(cents(1), cents(0), pct5)).toThrow(InvalidMoneyError);
  });
});

describe("gapPctHundredthsFloor (display only)", () => {
  it.each([
    [500, 10_000, 500],
    [1100, 4799, 2292], // $11.00 over $47.99 is 22.92…%
    [33, 3333, 99],
    [0, 1, 0],
  ])("gap %s over %s shows %s hundredths", (gap, base, expected) => {
    expect(gapPctHundredthsFloor(cents(gap), cents(base))).toBe(expected);
  });
});

describe("commissionToBps", () => {
  it.each([
    [0, 0],
    [0.02, 200],
    [0.05, 500],
    [0.08, 800],
    [0.5, 5000],
    [1, 10_000],
  ])("fraction %s → %s bps", (rate, expected) => {
    expect(commissionToBps(rate)).toBe(expected);
  });

  it.each([[null], [undefined], [-0.01], [1.01], [Number.NaN], [8]])(
    "%s is unknown (null)",
    (rate) => {
      expect(commissionToBps(rate)).toBeNull();
    },
  );
});

describe("formatting", () => {
  it.each([
    [0, "$0.00"],
    [5, "$0.05"],
    [4799, "$47.99"],
    [100000, "$1,000.00"],
    [12345678, "$123,456.78"],
    [MAX_PRICE_CENTS, "$1,000,000.00"],
  ])("%s cents → %s", (value, expected) => {
    expect(formatUsd(cents(value))).toBe(expected);
  });

  it.each([
    [0, "0%"],
    [100, "1%"],
    [500, "5%"],
    [750, "7.5%"],
    [1234, "12.34%"],
    [2292, "22.92%"],
  ])("%s hundredths → %s", (value, expected) => {
    expect(formatPct(value)).toBe(expected);
  });
});
