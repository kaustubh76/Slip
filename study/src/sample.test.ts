import type { Channel3Search, SearchOutcome } from "@slip/offers/search";
import { describe, expect, it } from "vitest";
import type { SampleQuery } from "./queries.js";
import { runSample } from "./sample.js";
import { hashOf, isIntact, type Snapshot } from "./snapshots.js";

/** The sampler spends the owner's credits, so what it does with a refusal is the point. */

const QUERIES: SampleQuery[] = [
  { slug: "one", query: "first thing", note: "" },
  { slug: "two", query: "second thing", note: "" },
  { slug: "three", query: "third thing", note: "" },
];

const found = (ids: string[]): SearchOutcome => ({
  ok: true,
  result: { body: { products: ids.map((id) => ({ id })) }, products: ids.map((id) => ({ id })) },
});

function stub(...outcomes: SearchOutcome[]): { search: Channel3Search; asked: string[] } {
  const asked: string[] = [];
  const queue = [...outcomes];
  return {
    asked,
    search: {
      async search(query) {
        asked.push(query);
        return queue.shift() ?? found([]);
      },
    },
  };
}

const run = async (search: Channel3Search) => {
  const saved: Snapshot[] = [];
  const report = await runSample({
    search,
    queries: QUERIES,
    limit: 30,
    now: () => new Date("2026-10-19T12:00:00.000Z"),
    save: (snapshot) => saved.push(snapshot),
  });
  return { ...report, saved };
};

describe("taking the sample", () => {
  it("asks each query once, in the order written", async () => {
    const { search, asked } = stub();
    const { manifest } = await run(search);
    expect(asked).toEqual(["first thing", "second thing", "third thing"]);
    expect(manifest.credits).toBe(3);
    expect(manifest.queries.map((q) => q.slug)).toEqual(["one", "two", "three"]);
  });

  it("keeps the response for each query, hashed so a later edit shows", async () => {
    const { search } = stub(found(["a", "b"]));
    const { saved } = await run(search);
    expect(saved[0]).toMatchObject({ slug: "one", query: "first thing" });
    // The snapshot is the response as it arrived, not a summary of it.
    expect(saved[0]).not.toHaveProperty("products");
    expect(saved[0]?.rawHash).toBe(hashOf({ products: [{ id: "a" }, { id: "b" }] }));
    expect(isIntact(saved[0] as Snapshot)).toBe(true);
  });

  it("stops the moment the credits run out, and keeps what was already paid for", async () => {
    const { search, asked } = stub(found(["a"]), {
      ok: false,
      status: 402,
      detail: "Channel3 answered 402",
    });
    const { manifest, stoppedBecause, saved } = await run(search);
    // The third query is never asked: spending into a 402 buys nothing.
    expect(asked).toEqual(["first thing", "second thing"]);
    expect(saved.map((s) => s.slug)).toEqual(["one"]);
    expect(manifest.queries).toHaveLength(1);
    expect(stoppedBecause).toContain("out of Channel3 credits");
  });

  it("counts a failed call as a credit, because Channel3 does", async () => {
    const { search } = stub({ ok: false, status: 500, detail: "Channel3 answered 500" });
    const { manifest, stoppedBecause } = await run(search);
    expect(manifest.credits).toBe(1);
    expect(manifest.queries).toEqual([]);
    expect(stoppedBecause).toContain("Channel3 answered 500");
  });

  it("never asks the same query twice", async () => {
    // A retry would spend a second credit on a question already answered.
    const { search, asked } = stub({ ok: false, status: 503, detail: "down" });
    await run(search);
    expect(asked).toEqual(["first thing"]);
  });
});
