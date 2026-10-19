import { silentLogger } from "@slip/app";
import { ManualClock, NOW } from "@slip/domain/testing";
import type { Channel3Search, SearchOutcome } from "@slip/offers/search";
import { describe, expect, it } from "vitest";
import { createCatalogueSearch } from "./search";

/**
 * Agent search against Channel3. Every test here is about the owner's credits or about what the
 * agent is told when they run out: a search costs a credit where product detail is free.
 */

const live = () => new AbortController().signal;

const product = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: "Trail shoe",
  description: "A trail shoe with a grippy sole.",
  key_features: ["Grippy"],
  offers: [
    {
      url: `https://store.example/${id}`,
      domain: "store.example",
      price: { price: 99.99, currency: "USD" },
      availability: "InStock",
      condition: "new",
      max_commission_rate: 0.05,
    },
  ],
  variants: null,
  ...over,
});

function stub(...outcomes: SearchOutcome[]) {
  const asked: { query: string; limit: number }[] = [];
  const queue = [...outcomes];
  const channel3: Channel3Search = {
    async search(query, limit) {
      asked.push({ query, limit });
      return (
        queue.shift() ?? {
          ok: true,
          result: { body: { products: [product("p1")] }, products: [product("p1")] },
        }
      );
    },
  };
  return { channel3, asked };
}

const catalogue = (channel3: Channel3Search, clock = new ManualClock(NOW)) => ({
  clock,
  search: createCatalogueSearch({ apiKey: "ch3", clock, log: silentLogger, channel3 }),
});

describe("what it answers", () => {
  it("maps Channel3's products, their offers and the product's own text", async () => {
    const { channel3 } = stub();
    const { search } = catalogue(channel3);
    const answer = await search.forMandate("m1").search("trail shoe", { limit: 10 }, live());
    expect(answer.ok).toBe(true);
    expect(answer.ok && answer.hits).toEqual([
      {
        productId: "p1",
        title: "Trail shoe",
        text: "A trail shoe with a grippy sole.\nGrippy",
        offers: [
          expect.objectContaining({ domain: "store.example", priceCents: 9_999, currency: "USD" }),
        ],
      },
    ]);
    expect(search.forMandate("m1").simulated).toBe(false);
  });

  it("says so when Channel3 lists nothing, rather than looking broken", async () => {
    const { channel3 } = stub({ ok: true, result: { body: { products: [] }, products: [] } });
    const answer = await catalogue(channel3)
      .search.forMandate("m1")
      .search("kayak", { limit: 10 }, live());
    expect(answer).toMatchObject({ ok: true, hits: [], hint: expect.any(String) });
  });

  it.each([
    [402, "OUT_OF_CREDITS"],
    [429, "RATE_LIMITED"],
    [500, "UNAVAILABLE"],
    [null, "TIMEOUT"],
  ])("turns %s into %s rather than throwing", async (status, reason) => {
    const { channel3 } = stub({ ok: false, status, detail: "no" });
    const answer = await catalogue(channel3)
      .search.forMandate("m1")
      .search("x", { limit: 10 }, live());
    expect(answer).toMatchObject({ ok: false, reason });
  });
});

describe("the owner's credits", () => {
  it("answers an identical query from the last result, spending nothing", async () => {
    const { channel3, asked } = stub();
    const { search } = catalogue(channel3);
    const tool = search.forMandate("m1");
    const first = await tool.search("Trail Shoe", { limit: 10 }, live());
    const again = await tool.search("  trail shoe ", { limit: 10 }, live());
    expect(asked).toHaveLength(1);
    expect(again).toEqual(first);
  });

  it("asks again for a different query or a different limit", async () => {
    const { channel3, asked } = stub();
    const tool = catalogue(channel3).search.forMandate("m1");
    await tool.search("trail shoe", { limit: 10 }, live());
    await tool.search("yoga mat", { limit: 10 }, live());
    await tool.search("trail shoe", { limit: 30 }, live());
    expect(asked).toHaveLength(3);
  });

  it("asks again once the cached answer is stale", async () => {
    const { channel3, asked } = stub();
    const clock = new ManualClock(NOW);
    const tool = catalogue(channel3, clock).search.forMandate("m1");
    await tool.search("trail shoe", { limit: 10 }, live());
    clock.advance(5 * 60_000);
    await tool.search("trail shoe", { limit: 10 }, live());
    expect(asked).toHaveLength(2);
  });

  it("never caches a failure: the next call should really try again", async () => {
    const { channel3, asked } = stub({ ok: false, status: 500, detail: "no" });
    const tool = catalogue(channel3).search.forMandate("m1");
    await tool.search("trail shoe", { limit: 10 }, live());
    await tool.search("trail shoe", { limit: 10 }, live());
    expect(asked).toHaveLength(2);
  });

  it("refuses past 60 uncached searches an hour, and says why", async () => {
    // Without this a looping agent could empty the owner's credits in minutes; nothing else in
    // Slip limits searches, since the retry limit counts checkouts.
    const { channel3, asked } = stub();
    const clock = new ManualClock(NOW);
    const tool = catalogue(channel3, clock).search.forMandate("m1");
    for (let i = 0; i < 60; i += 1) {
      const answer = await tool.search(`query ${i}`, { limit: 10 }, live());
      expect(answer.ok).toBe(true);
    }
    const refused = await tool.search("one too many", { limit: 10 }, live());
    expect(refused).toMatchObject({ ok: false, reason: "RATE_LIMITED" });
    expect(refused.ok === false && refused.detail).toContain("60 an hour");
    expect(asked).toHaveLength(60);
  });

  it("lets a cached query through even when the budget is spent", async () => {
    const { channel3 } = stub();
    const clock = new ManualClock(NOW);
    const tool = catalogue(channel3, clock).search.forMandate("m1");
    const first = await tool.search("trail shoe", { limit: 10 }, live());
    for (let i = 0; i < 59; i += 1) {
      await tool.search(`query ${i}`, { limit: 10 }, live());
    }
    expect(await tool.search("trail shoe", { limit: 10 }, live())).toEqual(first);
  });

  it("gives the allowance back as the hour rolls on", async () => {
    const { channel3 } = stub();
    const clock = new ManualClock(NOW);
    const tool = catalogue(channel3, clock).search.forMandate("m1");
    for (let i = 0; i < 60; i += 1) {
      await tool.search(`query ${i}`, { limit: 10 }, live());
    }
    expect(await tool.search("later", { limit: 10 }, live())).toMatchObject({ ok: false });
    clock.advance(61 * 60_000);
    expect(await tool.search("later", { limit: 10 }, live())).toMatchObject({ ok: true });
  });

  it("counts each permission's budget separately", async () => {
    const { channel3 } = stub();
    const clock = new ManualClock(NOW);
    const { search } = catalogue(channel3, clock);
    const mine = search.forMandate("m1");
    for (let i = 0; i < 60; i += 1) {
      await mine.search(`query ${i}`, { limit: 10 }, live());
    }
    expect(await mine.search("mine", { limit: 10 }, live())).toMatchObject({ ok: false });
    // One owner's agent cannot spend another owner's allowance.
    expect(await search.forMandate("m2").search("theirs", { limit: 10 }, live())).toMatchObject({
      ok: true,
    });
  });

  it("shares one cache across permissions: the same query costs one credit, not two", async () => {
    const { channel3, asked } = stub();
    const { search } = catalogue(channel3);
    await search.forMandate("m1").search("trail shoe", { limit: 10 }, live());
    await search.forMandate("m2").search("trail shoe", { limit: 10 }, live());
    expect(asked).toHaveLength(1);
  });
});
