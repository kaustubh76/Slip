import type { Cents } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { gapPercent, percentFromHundredths } from "./percent.js";

const pct = (part: number, base: number, above?: number) =>
  gapPercent(part as Cents, base as Cents, above === undefined ? {} : { above });

describe("gapPercent", () => {
  it.each([
    [1_100, 4_799, "23%"], // $11.00 over $47.99: whole from 10 % up
    [1_225, 10_000, "12%"],
    [480, 10_000, "4.8%"],
    [994, 10_000, "9.9%"],
    [995, 10_000, "10%"], // 9.95 % rounds half-up to 10.0, so it is shown whole
    [1_000, 10_000, "10%"],
    [5, 10_000, "0.1%"],
    [4, 10_000, "0%"],
    [300, 7_500, "4%"], // 4.0 drops its ".0"
  ])("%s of %s is %s", (part, base, shown) => {
    expect(pct(part, base)).toBe(shown);
  });

  it("a gap just past a limit never prints at or below it", () => {
    expect(pct(801, 16_000)).toBe("5%");
    expect(pct(801, 16_000, 500)).toBe("5.01%");
    expect(pct(8_001, 160_000, 500)).toBe("5.001%");
    expect(pct(1_040, 10_000, 1_000)).toBe("10.4%");
    // Exactly at the limit is not above it, so nothing is added.
    expect(pct(800, 16_000, 500)).toBe("5%");
  });

  it("whatever the prices and limit, a gap above the limit prints above it", () => {
    for (const base of [999, 4_799, 10_000, 16_000, 123_457]) {
      for (const above of [100, 500, 1_000, 1_250]) {
        for (let part = 1; part <= base / 4; part += Math.ceil(base / 997)) {
          if (part * 10_000 <= above * base) {
            continue;
          }
          const shown = Number.parseFloat(pct(part, base, above));
          expect(shown, `${part}/${base} above ${above}`).toBeGreaterThan(above / 100);
        }
      }
    }
  });

  it("refuses a zero base", () => {
    expect(() => pct(1, 0)).toThrow();
  });
});

describe("percentFromHundredths", () => {
  it.each([
    [214, "2.1%"],
    [845, "8.5%"],
    [994, "9.9%"],
    [995, "10%"],
    [1_245, "12%"],
    [1_250, "13%"],
    [500, "5%"],
    [5, "0.1%"],
    [4, "0%"],
    [0, "0%"],
  ])("%i hundredths → %s", (value, shown) => {
    expect(percentFromHundredths(value)).toBe(shown);
  });
});
