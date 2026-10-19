import type { Cents, Offer, ProductOffers } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { G1_SHARE_PCT_HUNDREDTHS, measureOne, productsFrom, summarise } from "./measure.js";
import type { Snapshot } from "./snapshots.js";

/**
 * The maths, on products built by hand. The numbers these produce go in the pitch, so each test
 * states the claim it protects rather than just the arithmetic.
 */

const offer = (over: Partial<Offer> = {}): Offer => ({
  url: `https://store-${over.domain ?? "a"}.example/p/1`,
  domain: "store-a.example",
  priceCents: 1_000 as Cents,
  currency: "USD",
  availability: "InStock",
  condition: "new",
  commissionBps: null,
  listingText: null,
  ...over,
});

const product = (offers: Offer[], over: Partial<ProductOffers> = {}): ProductOffers => ({
  productId: "p1",
  title: "Trail shoe",
  selectedOptions: [],
  offers,
  raw: {},
  rawHash: "hash",
  ...over,
});

const measure = (offers: Offer[]) => measureOne(product(offers), "trail-running-shoes");

describe("one product", () => {
  it("takes the cheapest against the priciest, as a gap on the cheapest", () => {
    const m = measure([
      offer({ domain: "a.example", url: "https://a.example/1", priceCents: 1_000 as Cents }),
      offer({ domain: "b.example", url: "https://b.example/1", priceCents: 1_250 as Cents }),
    ]);
    expect(m.spread).toMatchObject({ cheapest: 1_000, priciest: 1_250, gapCents: 250 });
    // 25 % of the cheapest price, in hundredths, the way the rules measure it.
    expect(m.spread?.gapPctHundredths).toBe(2_500);
  });

  it("has no spread with one comparable offer, however many offers there were", () => {
    // This is the R2 case: nothing to compare, which the study must not count as a zero gap.
    const m = measure([
      offer({ url: "https://a.example/1" }),
      offer({ url: "https://b.example/1", availability: "OutOfStock" }),
      offer({ url: "https://c.example/1", condition: "used" }),
      offer({ url: "https://d.example/1", priceCents: null }),
      offer({ url: "https://e.example/1", currency: "EUR" }),
    ]);
    expect(m.offers).toBe(5);
    expect(m.comparable).toBe(1);
    expect(m.spread).toBeNull();
  });

  it("counts a listing that appears twice once, as the check does", () => {
    const m = measure([
      offer({ url: "https://a.example/p/1?utm_source=x" }),
      offer({ url: "https://a.example/p/1" }),
    ]);
    expect(m.comparable).toBe(1);
    expect(m.spread).toBeNull();
  });

  describe("the commission conflict", () => {
    it("is a conflict when the top payer is dearer than the cheapest", () => {
      const m = measure([
        offer({ url: "https://a.example/1", priceCents: 1_000 as Cents, commissionBps: 100 }),
        offer({ url: "https://b.example/1", priceCents: 1_200 as Cents, commissionBps: 800 }),
      ]);
      expect(m.topCommissionIsDearer).toBe(true);
    });

    it("is not a conflict when the cheapest also pays the most", () => {
      const m = measure([
        offer({ url: "https://a.example/1", priceCents: 1_000 as Cents, commissionBps: 800 }),
        offer({ url: "https://b.example/1", priceCents: 1_200 as Cents, commissionBps: 100 }),
      ]);
      expect(m.topCommissionIsDearer).toBe(false);
    });

    it("is not counted when every rate is the same, or when fewer than two are known", () => {
      // Products that could never show a conflict must not dilute the share that do.
      const flat = measure([
        offer({ url: "https://a.example/1", priceCents: 1_000 as Cents, commissionBps: 500 }),
        offer({ url: "https://b.example/1", priceCents: 1_200 as Cents, commissionBps: 500 }),
      ]);
      expect(flat.topCommissionIsDearer).toBeNull();
      const unknown = measure([
        offer({ url: "https://a.example/1", commissionBps: 500 }),
        offer({ url: "https://b.example/1", priceCents: 1_200 as Cents, commissionBps: null }),
      ]);
      expect(unknown.topCommissionIsDearer).toBeNull();
    });

    it("reads a zero rate as a known zero, not as missing", () => {
      const m = measure([
        offer({ url: "https://a.example/1", priceCents: 1_200 as Cents, commissionBps: 0 }),
        offer({ url: "https://b.example/1", priceCents: 1_000 as Cents, commissionBps: 0 }),
      ]);
      // Both known and equal: no conflict to find.
      expect(m.commissionKnown).toBe(2);
      expect(m.topCommissionIsDearer).toBeNull();
    });
  });
});

describe("the sample", () => {
  const snapshot = (slug: string, ids: string[]): Snapshot => ({
    slug,
    query: slug,
    fetchedAt: "2026-10-19T00:00:00.000Z",
    rawHash: "x",
    body: { products: ids.map((id) => ({ id, title: id })) },
  });

  it("counts a product found by two queries once, and remembers which found it first", () => {
    const products = productsFrom([
      snapshot("yoga-mat", ["a", "b"]),
      snapshot("trail-running-shoes", ["b", "c"]),
    ]);
    expect(products.map((p) => [(p.raw as { id: string }).id, p.foundBy])).toEqual([
      ["a", "yoga-mat"],
      ["b", "yoga-mat"],
      ["c", "trail-running-shoes"],
    ]);
  });

  it("ignores anything in a response that is not a product with an id", () => {
    const products = productsFrom([
      { ...snapshot("x", []), body: { products: [{ title: "no id" }, null, 7, { id: "" }] } },
    ]);
    expect(products).toEqual([]);
  });
});

describe("the numbers", () => {
  const twoOffers = () =>
    measure([
      offer({ url: "https://a.example/1", priceCents: 1_000 as Cents }),
      offer({ url: "https://b.example/1", priceCents: 1_100 as Cents }),
    ]);
  const oneOffer = () => measure([offer({ url: "https://a.example/1" })]);

  it("reports the share with two or more against the whole sample", () => {
    const numbers = summarise([twoOffers(), twoOffers(), oneOffer(), oneOffer()]);
    expect(numbers.products).toBe(4);
    expect(numbers.withTwoOrMore).toBe(2);
    expect(numbers.shareWithTwoOrMorePctHundredths).toBe(5_000);
    // G1 wants 60 %: half the sample fails it, and the study says so rather than rounding up.
    expect(numbers.g1Pass).toBe(false);
    expect(G1_SHARE_PCT_HUNDREDTHS).toBe(6_000);
  });

  it("passes G1 at exactly 60 %", () => {
    const measures = [twoOffers(), twoOffers(), twoOffers(), oneOffer(), oneOffer()];
    expect(summarise(measures).shareWithTwoOrMorePctHundredths).toBe(6_000);
    expect(summarise(measures).g1Pass).toBe(true);
  });

  it("takes the median gap over the products that have one, not over the whole sample", () => {
    const wide = measure([
      offer({ url: "https://a.example/1", priceCents: 1_000 as Cents }),
      offer({ url: "https://b.example/1", priceCents: 2_000 as Cents }),
    ]);
    const numbers = summarise([twoOffers(), wide, oneOffer()]);
    // Gaps are 100 and 1000 cents; the lower median of two values is the first.
    expect(numbers.medianGapCents).toBe(100);
    expect(numbers.widestGapPctHundredths).toBe(10_000);
  });

  it("an empty sample reports nothing rather than zero", () => {
    const numbers = summarise([]);
    expect(numbers).toMatchObject({
      products: 0,
      withTwoOrMore: 0,
      medianGapCents: null,
      medianGapPctHundredths: null,
      commissionConflictPctHundredths: null,
      g1Pass: false,
    });
  });
});
