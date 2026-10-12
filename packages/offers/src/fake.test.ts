import { offer } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { FakeOffersSource } from "./fake.js";

const live = () => new AbortController().signal;

describe("FakeOffersSource", () => {
  it("returns a copy of every offer with the variant, a raw response and its hash", async () => {
    const source = new FakeOffersSource();
    const a = offer({ price: 47.99 });
    source.setProduct({
      productId: "p1",
      title: "Shoe",
      selectedOptions: [{ name: "Size", label: "9" }],
      offers: [a],
    });
    const result = await source.fetchProduct("p1", live());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.product).toMatchObject({
        productId: "p1",
        title: "Shoe",
        selectedOptions: [{ name: "Size", label: "9" }],
        offers: [a],
      });
      expect(result.product.rawHash).toMatch(/^[0-9a-f]{64}$/);
      result.product.offers.pop();
    }
    const again = await source.fetchProduct("p1", live());
    expect(again.ok && again.product.offers).toHaveLength(1);
    expect(source.calls).toEqual(["p1", "p1"]);
  });

  it("an unknown product is NOT_FOUND", async () => {
    expect(await new FakeOffersSource().fetchProduct("nope", live())).toMatchObject({
      ok: false,
      reason: "NOT_FOUND",
    });
  });

  it("scripted failures apply once each; down applies until it comes back", async () => {
    const source = new FakeOffersSource();
    source.setProduct({ productId: "p1", offers: [offer({ price: 1 })] });
    source.failNext("OUT_OF_CREDITS");
    expect(await source.fetchProduct("p1", live())).toMatchObject({
      ok: false,
      reason: "OUT_OF_CREDITS",
    });
    expect((await source.fetchProduct("p1", live())).ok).toBe(true);
    source.goDown();
    expect(await source.fetchProduct("p1", live())).toMatchObject({
      ok: false,
      reason: "UNAVAILABLE",
    });
    source.comeBack();
    expect((await source.fetchProduct("p1", live())).ok).toBe(true);
  });

  it("a hanging call ends as TIMEOUT when the caller aborts", async () => {
    const source = new FakeOffersSource();
    source.failNext("hang");
    const controller = new AbortController();
    const pending = source.fetchProduct("p1", controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, reason: "TIMEOUT" });
  });
});
