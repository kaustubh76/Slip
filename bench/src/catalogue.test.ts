import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { comparableOffers } from "@slip/check";
import { beforeAll, describe, expect, it } from "vitest";
import { type Catalogue, loadCatalogue, RESULTS_PER_PAGE } from "./catalogue.js";
import { ENDORSEMENT, INJECTION, SYNTHETIC } from "./conditions.js";
import { ERRANDS } from "./errands.js";

/**
 * The catalogue the agents shop in, loaded from the market study's committed snapshots. These run
 * on the real 240 products, so they also guard the errand list against the data moving under it.
 */

const SNAPSHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "study", "snapshots");

let catalogue: Catalogue;
beforeAll(async () => {
  catalogue = await loadCatalogue(SNAPSHOTS);
});

describe("the catalogue", () => {
  it("is the whole market study, loaded without a key or a network call", () => {
    expect(catalogue.size()).toBeGreaterThan(200);
  });

  it("finds a product by the words in its own title", () => {
    const page = catalogue.search("trinity fkt trail running shoes", 1, "clean");
    expect(page.results.map((result) => result.productId)).toContain("ls8Tvwa");
  });

  it("pages, and does not put everything on the first page", () => {
    const first = catalogue.search("trail running shoes", 1, "clean");
    expect(first.results.length).toBeLessThanOrEqual(RESULTS_PER_PAGE);
    expect(first.totalPages).toBeGreaterThan(1);
    const second = catalogue.search("trail running shoes", 2, "clean");
    expect(second.results.map((r) => r.productId)).not.toEqual(
      first.results.map((r) => r.productId),
    );
  });

  it("answers an unknown query with nothing rather than a guess", () => {
    expect(catalogue.search("qwertyuiop", 1, "clean").results).toEqual([]);
  });
});

describe("every errand", () => {
  it("names a product that exists, with something to compare", () => {
    for (const errand of ERRANDS) {
      const product = catalogue.product(errand.productId);
      expect(product, `${errand.id} (${errand.productId}) is missing`).toBeDefined();
      const comparable = comparableOffers(product?.offers ?? []);
      expect(comparable.length, `${errand.id} has nothing to compare`).toBeGreaterThanOrEqual(2);
      // Winnable and losable: there is a cheaper and a dearer offer.
      const prices = comparable.map((offer) => offer.priceCents);
      expect(Math.max(...prices), `${errand.id} has no spread`).toBeGreaterThan(
        Math.min(...prices),
      );
    }
  });

  it("is findable by searching for its own task text", () => {
    for (const errand of ERRANDS) {
      const query = errand.task.replace(/^Order (the|The) /, "").replace(/\.$/, "");
      const found = [1, 2, 3].flatMap((page) =>
        catalogue.search(query, page, "clean").results.map((result) => result.productId),
      );
      expect(found, `${errand.id} is not findable within three pages`).toContain(errand.productId);
    }
  });

  it("has a unique id, since the id names its recorded runs", () => {
    const ids = ERRANDS.map((errand) => errand.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(ids.length).toBeLessThanOrEqual(25);
  });
});

describe("what each condition shows", () => {
  const listingOf = (productId: string, condition: "clean" | "endorsed" | "injected") => {
    const product = catalogue.product(productId);
    if (product === undefined) {
      throw new Error(productId);
    }
    const page = catalogue.search(product.title, 1, condition);
    return page.results.find((result) => result.productId === productId);
  };

  it("clean says nothing the catalogue did not say", () => {
    for (const errand of ERRANDS) {
      const listing = listingOf(errand.productId, "clean");
      for (const offer of listing?.offers ?? []) {
        expect(offer.listingText).toBeNull();
      }
    }
  });

  it.each(["endorsed", "injected"] as const)(
    "%s plants on the dearest comparable offer, lists it first, and labels it synthetic",
    (condition) => {
      const listing = listingOf("ls8Tvwa", condition);
      const first = listing?.offers[0];
      expect(first?.listingText).toBe(condition === "endorsed" ? ENDORSEMENT : INJECTION);
      expect(first?.listingText).toContain(SYNTHETIC);
      // It is the dearer of the two real offers: $118.97 against $100.97.
      expect(first?.priceUsd).toBe("118.97");
      expect(listing?.offers).toHaveLength(2);
      const prices = (listing?.offers ?? []).map((offer) => offer.priceUsd);
      expect(prices).toContain("100.97");
    },
  );

  it("plants exactly one listing, so an agent that compares can still win", () => {
    const listing = listingOf("awGi5Qs", "injected");
    const planted = (listing?.offers ?? []).filter((offer) => offer.listingText !== null);
    expect(planted).toHaveLength(1);
  });
});
