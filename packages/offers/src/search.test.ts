import { OfferSchema } from "@slip/domain";
import type { Fetch } from "@slip/http";
import { describe, expect, it } from "vitest";
import { channel3SearchHits, createChannel3Search } from "./search.js";

/**
 * Search against Channel3's documented response. The product bodies here are the shape the live
 * API returned on 19 Oct (see `study/snapshots/`), including the thing that matters most: an offer
 * carries no text of its own, and the only words an agent could read are the product's.
 */

const live = () => new AbortController().signal;

const offer = (over: Record<string, unknown> = {}) => ({
  url: "https://dickssportinggoods.com/p/1",
  domain: "dickssportinggoods.com",
  price: { price: 149.99, compare_at_price: null, currency: "USD" },
  availability: "InStock",
  condition: "new",
  max_commission_rate: 0.05,
  dimensions: { length: null, width: null, height: null, weight: null },
  ...over,
});

const product = (over: Record<string, unknown> = {}) => ({
  id: "t1SLQyj",
  title: "Experience Wild 3+ Trail Running Shoes",
  description: "A trail shoe with a grippy outsole.",
  key_features: ["Vibram outsole", "Waterproof"],
  brands: [{ name: "Brandy" }],
  offers: [offer()],
  variants: null,
  ...over,
});

function stub(answer: Response | Error) {
  const calls: { url: string; body: unknown }[] = [];
  const fetch = (async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? "{}")) });
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  }) as Fetch;
  return { fetch, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const search = (answer: Response | Error) => {
  const { fetch, calls } = stub(answer);
  return { calls, channel3: createChannel3Search({ apiKey: "ch3_test_key", fetch }) };
};

describe("the search request", () => {
  it("asks for one page of results with the key in the header", async () => {
    const { channel3, calls } = search(json(200, { products: [product()] }));
    const outcome = await channel3.search("trail running shoes", 10, live());
    expect(outcome.ok).toBe(true);
    expect(calls[0]?.url).toBe("https://api.trychannel3.com/v1/search");
    expect(calls[0]?.body).toEqual({ query: "trail running shoes", limit: 10 });
  });

  it.each([
    [402, "no credits left"],
    [401, "a rejected key"],
    [429, "too many requests"],
    [500, "Channel3 itself"],
  ])("answers %i (%s) without throwing", async (status) => {
    const { channel3 } = search(json(status, { detail: "nope" }));
    const outcome = await channel3.search("x", 10, live());
    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.status).toBe(status);
  });

  it("an unreachable Channel3 is reported, not thrown", async () => {
    const { channel3 } = search(new TypeError("fetch failed"));
    expect(await channel3.search("x", 10, live())).toMatchObject({ ok: false, status: null });
  });

  it("an answer with no products is not a search result", async () => {
    const { channel3 } = search(json(200, { nothing: true }));
    expect(await channel3.search("x", 10, live())).toMatchObject({ ok: false });
  });
});

describe("reading what came back", () => {
  it("maps the offers exactly as a checkout would", () => {
    const [hit] = channel3SearchHits({ products: [product()] });
    expect(hit?.productId).toBe("t1SLQyj");
    expect(hit?.title).toBe("Experience Wild 3+ Trail Running Shoes");
    expect(hit?.offers).toHaveLength(1);
    // The domain's own rules, so a search can never show a price the check reads differently.
    expect(OfferSchema.parse(hit?.offers[0])).toEqual(hit?.offers[0]);
    expect(hit?.offers[0]).toMatchObject({
      domain: "dickssportinggoods.com",
      priceCents: 14_999,
      currency: "USD",
      availability: "InStock",
      condition: "new",
      commissionBps: 500,
    });
  });

  it("takes the text from the product, because an offer has none (D67)", () => {
    const [hit] = channel3SearchHits({ products: [product()] });
    expect(hit?.offers[0]?.listingText).toBeNull();
    expect(hit?.text).toBe("A trail shoe with a grippy outsole.\nVibram outsole\nWaterproof");
  });

  it("has no text when the product has none, rather than an empty string", () => {
    const [hit] = channel3SearchHits({
      products: [product({ description: null, key_features: [] })],
    });
    expect(hit?.text).toBeNull();
  });

  it("caps a very long description rather than dropping it", () => {
    const [hit] = channel3SearchHits({
      products: [product({ description: "x".repeat(5_000), key_features: [] })],
    });
    expect(hit?.text).toHaveLength(2_000);
  });

  it("drops a product it cannot read instead of guessing", () => {
    const hits = channel3SearchHits({
      products: [{ title: "no id" }, { id: "  " }, product(), "nope", null],
    });
    expect(hits.map((hit) => hit.productId)).toEqual(["t1SLQyj"]);
  });

  it("keeps a product whose offers all dropped out: the agent may still want to see it", () => {
    const hits = channel3SearchHits({
      products: [product({ offers: [offer({ url: "javascript:alert(1)" })] })],
    });
    expect(hits[0]?.offers).toEqual([]);
  });

  it("an answer that is not a search result is no hits", () => {
    for (const body of [null, {}, { products: "many" }, []]) {
      expect(channel3SearchHits(body)).toEqual([]);
    }
  });
});
