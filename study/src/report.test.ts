import { describe, expect, it } from "vitest";
import type { StudyNumbers } from "./measure.js";
import { renderReport } from "./report.js";

/**
 * What the report claims about its own sample. The commission figure is the one the pitch leans on
 * now that G1 has failed, so the thing under test is not the arithmetic — `measure.test.ts` has
 * that — but whether a reader can tell what the percentage is *of* without opening `measure.ts`.
 */

const numbers = (over: Partial<StudyNumbers> = {}): StudyNumbers =>
  ({
    products: 240,
    priced: 240,
    offersListed: 321,
    offersMapped: 321,
    offersComparable: 318,
    excluded: { noPrice: 0, notUsd: 0, notInStock: 0, notNew: 0, duplicate: 0 },
    countsByComparable: [],
    perQuery: [],
    withTwoOrMore: 44,
    shareWithTwoOrMorePctHundredths: 1_833,
    g1Pass: false,
    medianGapPctHundredths: 1_702,
    medianGapCents: 1_231,
    widestGapPctHundredths: 9_000,
    quartileGapPctHundredths: { lower: 0, upper: 3_000 },
    suspectGrouping: 3,
    medianGapPctHundredthsExcludingSuspect: 1_667,
    commissionConsidered: 40,
    commissionConflicts: 19,
    commissionConflictPctHundredths: 4_750,
    ...over,
  }) as StudyNumbers;

const report = (over: Partial<StudyNumbers> = {}): string =>
  renderReport({
    manifest: { sampledAt: "2026-10-19T10:00:00.000Z", credits: 8, queries: [] },
    numbers: numbers(over),
    measures: [],
    text: {
      products: 240,
      withText: 240,
      totalChars: 170_000,
      medianChars: 712,
      longerThanShown: 0,
      shownLimit: 2_000,
      candidates: [],
    },
  });

describe("the commission figure's denominator", () => {
  it("names the population in the table, which is not the comparable one", () => {
    const text = report();
    expect(text).toContain("19 of 40 where rates differ");
    // The old label said "comparable", and 44 products are comparable — not 40.
    expect(text).not.toContain("19 of 40 comparable");
  });

  it("says what the share is of, and what it is not of", () => {
    const text = report();
    expect(text).toContain("40 products where two offers stated **different** commission rates");
    expect(text).toContain("not of the 240 sampled");
    expect(text).toContain("44 with two or more comparable offers");
  });

  it("accounts for the products excluded from it, rather than leaving them unexplained", () => {
    // 44 comparable, 40 considered: four could never have shown a conflict.
    const text = report();
    expect(text).toContain("The other 4 could not show a conflict at all");
    expect(text).toContain("rather than counted as agreement");
  });

  it("says nothing about exclusions when there were none", () => {
    const text = report({ withTwoOrMore: 40, commissionConsidered: 40 });
    expect(text).toContain("40 products where two offers stated **different** commission rates");
    expect(text).not.toContain("could not show a conflict at all");
  });

  it("says so plainly when no product could show a conflict", () => {
    const text = report({
      commissionConsidered: 0,
      commissionConflicts: 0,
      commissionConflictPctHundredths: null,
    });
    expect(text).toContain("No product in this sample had two offers stating different commission");
  });
});
