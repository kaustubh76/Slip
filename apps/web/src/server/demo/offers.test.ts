import { FakeOffersSource } from "@slip/offers/fake";
import { describe, expect, it } from "vitest";
import { DEMO_PRODUCTS } from "./catalogue";
import { DemoOffers } from "./offers";

const product = (productId: string) => ({
  productId,
  title: "Lamp",
  offers: DEMO_PRODUCTS[0]?.offers ?? [],
});

describe("DemoOffers", () => {
  it("an outage belongs to one product, and ends", async () => {
    const offers = new DemoOffers(new FakeOffersSource());
    offers.setProduct(product("lamp--aaaaaaaa"));
    offers.setProduct(product("lamp--bbbbbbbb"));
    offers.setDown("lamp--aaaaaaaa", true);
    const signal = new AbortController().signal;
    expect(await offers.fetchProduct("lamp--aaaaaaaa", signal)).toMatchObject({
      ok: false,
      reason: "UNAVAILABLE",
    });
    expect((await offers.fetchProduct("lamp--bbbbbbbb", signal)).ok).toBe(true);
    offers.setDown("lamp--aaaaaaaa", false);
    expect((await offers.fetchProduct("lamp--aaaaaaaa", signal)).ok).toBe(true);
  });

  it("keeps the product as listed, for a price change", () => {
    const offers = new DemoOffers(new FakeOffersSource());
    offers.setProduct(product("lamp--aaaaaaaa"));
    const listed = offers.product("lamp--aaaaaaaa");
    expect(listed?.offers).toHaveLength(2);
    // A copy: editing it changes nothing until it is set again.
    listed?.offers.pop();
    expect(offers.product("lamp--aaaaaaaa")?.offers).toHaveLength(2);
  });
});
