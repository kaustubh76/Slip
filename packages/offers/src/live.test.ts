import { createHash } from "node:crypto";
import { OfferSchema } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { createChannel3Offers } from "./channel3.js";
import { channel3SearchHits, createChannel3Search } from "./search.js";

/**
 * Channel3 for real (`CHANNEL3_API_KEY=… pnpm test:live:channel3`). Skipped otherwise, so this file
 * is part of the ordinary suite and costs nothing until a key exists.
 *
 * The offline tests prove the mapping against fixtures written from the documentation; only this
 * file can prove the documentation. Neither call here costs a credit: product detail is free, and
 * search — which is not — is never used.
 */

const apiKey = process.env["CHANNEL3_API_KEY"];
/** A product id from the owner's catalogue, if there is one to hand. */
const productId = process.env["CHANNEL3_TEST_PRODUCT_ID"] ?? "";

if (apiKey === undefined || apiKey === "") {
  describe("Channel3, live", () => {
    it.skip("skipped: set CHANNEL3_API_KEY (pnpm test:live:channel3)", () => {});
  });
} else {
  const offers = createChannel3Offers({ apiKey });
  const deadline = () => AbortSignal.timeout(15_000);

  describe("Channel3, live", () => {
    it("accepts the key, and says which product it has never heard of", async () => {
      // A key Channel3 rejects answers 401 → UNAVAILABLE, so NOT_FOUND proves four things at once:
      // the base url, the path, the `x-api-key` header, and that this key works.
      const result = await offers.fetchProduct("slip_no_such_product_000", deadline());
      expect(result).toMatchObject({ ok: false, reason: "NOT_FOUND" });
    }, 20_000);

    /**
     * Search costs a credit, so it is opt-in twice over: the key, and `CHANNEL3_LIVE_SEARCH=1`.
     * Running the whole suite with a key in the environment must never spend one by accident.
     */
    it.skipIf(process.env["CHANNEL3_LIVE_SEARCH"] !== "1")(
      "a real search returns products the domain accepts, with the text an agent would read",
      async () => {
        const outcome = await createChannel3Search({ apiKey }).search(
          "trail running shoes",
          5,
          deadline(),
        );
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) {
          return;
        }
        const hits = channel3SearchHits(outcome.result.body);
        expect(hits.length).toBeGreaterThan(0);
        for (const hit of hits) {
          expect(hit.productId).not.toBe("");
          for (const offer of hit.offers) {
            // The same bar a checkout holds an offer to: a search must not show a price the
            // check would read differently.
            expect(OfferSchema.parse(offer)).toEqual(offer);
          }
        }
        // The point of D69: on real data this text is the only thing an agent can read, and the
        // steering check is asked about exactly it.
        expect(hits.some((hit) => (hit.text ?? "") !== "")).toBe(true);
      },
      30_000,
    );

    it.skipIf(productId === "")(
      "returns offers the domain itself accepts",
      async () => {
        const result = await offers.fetchProduct(productId, deadline());
        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }
        const product = result.product;
        expect(product.productId).toBe(productId);
        expect(product.rawHash).toBe(
          createHash("sha256").update(JSON.stringify(product.raw)).digest("hex"),
        );
        // The real contract: every mapped offer must satisfy the domain's own rules, or the
        // comparison would be running on values it was never built to compare.
        for (const offer of product.offers) {
          expect(OfferSchema.parse(offer)).toEqual(offer);
        }
        // A listed product with no offer at all would make this suite pass while proving nothing.
        expect(product.offers.length).toBeGreaterThan(0);
      },
      20_000,
    );
  });
}
