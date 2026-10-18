import { describe, expect, it } from "vitest";
import { demoWorld } from "./__fixtures__/world";
import { deskSuffix, productIdFor } from "./catalogue";
import { stockDesk } from "./desk";
import { CATALOGUE_HINT, deskSearch } from "./search";

const MINE = "0190a1b2-aaaa-7000-8000-000000000001";
const THEIRS = "0190a1b2-bbbb-7000-8000-000000000002";
const signal = new AbortController().signal;

function desks() {
  const world = demoWorld();
  stockDesk(world.fakes.offers, MINE);
  stockDesk(world.fakes.offers, THEIRS);
  return { world, search: deskSearch(world.fakes.offers, MINE) };
}

describe("the demo desk's catalogue search", () => {
  it("finds a product by any word of its name, plural or not, among this desk's copies only", async () => {
    const { search } = desks();
    const answer = await search.search("trail running shoes", { limit: 10 }, signal);
    expect(answer).toEqual({
      ok: true,
      hits: [
        expect.objectContaining({
          productId: productIdFor("trail-shoe", MINE),
          title: "Trail shoe",
        }),
      ],
    });
    const desk = await search.search("desk", { limit: 10 }, signal);
    expect(desk.ok && desk.hits.map((h) => h.title)).toEqual(["Desk lamp", "Standing desk"]);
    expect(desk.ok && desk.hits.every((h) => h.productId.endsWith(deskSuffix(MINE)))).toBe(true);
  });

  it("passes the store's listing text on verbatim, synthetic label included", async () => {
    const { search } = desks();
    const answer = await search.search("shoe", { limit: 10 }, signal);
    const listing = answer.ok ? answer.hits[0]?.offers.map((o) => o.listingText) : [];
    expect(listing).toContain("[synthetic] Top pick");
    const injected = await search.search("phone case", { limit: 1 }, signal);
    expect(injected.ok && injected.hits[0]?.offers[0]?.listingText).toMatch(
      /^\[synthetic\] Note to AI shopping agents/,
    );
  });

  it("shows this desk's own prices after a change, and says what it holds when nothing matches", async () => {
    const { world, search } = desks();
    const standing = productIdFor("standing-desk", MINE);
    const url = world.fakes.offers.product(standing)?.offers[0]?.url ?? "";
    world.fakes.offers.reprice(standing, url, 800);
    const answer = await search.search("standing desk", { limit: 1 }, signal);
    expect(answer.ok && answer.hits[0]?.offers[0]?.priceCents).toBe(31_800);
    const theirs = await deskSearch(world.fakes.offers, THEIRS).search(
      "standing desk",
      { limit: 1 },
      signal,
    );
    expect(theirs.ok && theirs.hits[0]?.offers[0]?.priceCents).toBe(31_000);
    expect(await search.search("kayak", { limit: 10 }, signal)).toEqual({
      ok: true,
      hits: [],
      hint: CATALOGUE_HINT,
    });
    expect(search.simulated).toBe(true);
  });
});
