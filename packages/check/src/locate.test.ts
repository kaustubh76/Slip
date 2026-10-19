import { describe, expect, it } from "vitest";
import { offer } from "./__fixtures__/builders.js";
import { dedupeByNormalizedUrl } from "./comparable.js";
import { locateChosen } from "./locate.js";
import { domainOf, normalizeOfferUrl } from "./url.js";

describe("normalizeOfferUrl", () => {
  it.each([
    ["https://store.example/p/1", "store.example/p/1"],
    ["http://store.example/p/1", "store.example/p/1"],
    ["HTTPS://WWW.Store.Example/p/1", "store.example/p/1"],
    ["https://store.example/p/1/", "store.example/p/1"],
    ["https://store.example/", "store.example/"],
    ["https://store.example/p/1#reviews", "store.example/p/1"],
    ["https://store.example/p/1?utm_source=x&utm_medium=y", "store.example/p/1"],
    ["https://store.example/p/1?ref=aff&tag=slip-20&gclid=1", "store.example/p/1"],
    ["https://store.example/p/1?size=m&color=black", "store.example/p/1?color=black&size=m"],
    ["https://store.example/p/1?color=black&size=m", "store.example/p/1?color=black&size=m"],
    ["https://store.example:8443/p/1", "store.example:8443/p/1"],
    ["  https://store.example/p/1  ", "store.example/p/1"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeOfferUrl(input)).toBe(expected);
  });

  it.each([["not a url"], ["ftp://store.example/p/1"], ["mailto:x@y.z"], [""]])(
    "%s is not a listing URL",
    (input) => {
      expect(normalizeOfferUrl(input)).toBeNull();
    },
  );

  it("keeps non-tracking query values that differ", () => {
    expect(normalizeOfferUrl("https://s.example/p?v=1")).not.toBe(
      normalizeOfferUrl("https://s.example/p?v=2"),
    );
  });
});

describe("domainOf", () => {
  it.each([
    ["https://www.nike.com/t/shoe", "nike.com"],
    ["http://Store.Example/x", "store.example"],
    ["https://shop.store.example/x", "shop.store.example"],
  ])("%s → %s", (input, expected) => {
    expect(domainOf(input)).toBe(expected);
  });

  it("is null for non-URLs", () => {
    expect(domainOf("nike.com/t/shoe")).toBeNull();
  });
});

describe("locateChosen", () => {
  const a = offer({ price: 10, url: "https://store-a.example/p/1", domain: "store-a.example" });
  const b = offer({
    price: 11,
    url: "https://store-b.example/p/1?size=m",
    domain: "store-b.example",
  });
  const c1 = offer({ price: 12, url: "https://store-c.example/p/1", domain: "store-c.example" });
  const c2 = offer({ price: 13, url: "https://store-c.example/p/2", domain: "store-c.example" });
  const offers = [a, b, c1, c2];

  it("matches the exact URL first", () => {
    expect(locateChosen(offers, a.url)).toEqual({ offer: a, matchedBy: "url" });
  });

  it("matches a normalised URL (www, scheme, tracking, order, trailing slash)", () => {
    expect(locateChosen(offers, "http://www.store-b.example/p/1/?utm_source=x&size=m#top")).toEqual(
      {
        offer: b,
        matchedBy: "normalized",
      },
    );
  });

  it("falls back to the domain when exactly one listing is sold there", () => {
    expect(locateChosen(offers, "https://store-a.example/some/other/path")).toEqual({
      offer: a,
      matchedBy: "domain",
    });
  });

  it("refuses an ambiguous domain match", () => {
    expect(locateChosen(offers, "https://store-c.example/p/3")).toBeNull();
  });

  it("names the store from the catalogue's domain field, not from a redirect host", () => {
    // Measured, not supposed: Channel3's offer urls are redirects through its own host, so a
    // url's host is often not a store at all. The domain fallback has to compare the store.
    const odd = offer({
      price: 9,
      url: "https://cdn-redirect.example/go?x=1",
      domain: "www.store-d.example",
    });
    expect(locateChosen([...offers, odd], "https://store-d.example/anything")).toEqual({
      offer: odd,
      matchedBy: "domain",
    });
    // And the redirect host is nobody's store: matching it would be guessing.
    expect(locateChosen([...offers, odd], "https://cdn-redirect.example/other")).toBeNull();
  });

  it("finds the offer a Channel3 search showed, whose attribution id has since changed", () => {
    // The bug this prevents: Channel3 regenerates `aid` on every call, so the url an agent is
    // given by a search is never byte-identical to the one in the snapshot the checkout prices
    // from. Before `aid` was dropped from the match, every real purchase was refused as
    // OFFER_NOT_FOUND — and the domain fallback could not save it, because both offers share
    // Channel3's redirect host.
    const shown = "https://buy.trychannel3.com/t1SLQyj-fdOw-CNrACL?o=01KXK7E&aid=01M59ZKXTBYQDH";
    const snapshot = [
      offer({
        price: 149.99,
        domain: "dickssportinggoods.com",
        url: "https://buy.trychannel3.com/t1SLQyj-fdOw-CNrACL?o=01KXK7E&aid=01M5A1BD25G798",
      }),
      offer({
        price: 118.97,
        domain: "publiclands.com",
        url: "https://buy.trychannel3.com/t1SLQyj-2Msk-CNrACL?o=01M2TJC&aid=01M5A1BD25G798",
      }),
    ];
    const found = locateChosen(snapshot, shown);
    expect(found?.matchedBy).toBe("normalized");
    expect(found?.offer.domain).toBe("dickssportinggoods.com");
  });

  it("returns null for an unknown store and for garbage input", () => {
    expect(locateChosen(offers, "https://store-z.example/p/1")).toBeNull();
    expect(locateChosen(offers, "not a url")).toBeNull();
    expect(locateChosen([], a.url)).toBeNull();
  });
});

describe("dedupeByNormalizedUrl", () => {
  it("keeps the first of each listing and preserves order", () => {
    const first = offer({ price: 10, url: "https://store-a.example/p/1" });
    const dupe = offer({ price: 10, url: "https://www.store-a.example/p/1/?utm_campaign=x" });
    const other = offer({ price: 11, url: "https://store-b.example/p/1" });
    expect(dedupeByNormalizedUrl([first, dupe, other])).toEqual([first, other]);
    expect(dedupeByNormalizedUrl([dupe, first, other])).toEqual([dupe, other]);
  });

  it("keeps unparseable URLs apart by their raw string", () => {
    const x = offer({ price: 10, url: "https://x.example/p/1" });
    expect(dedupeByNormalizedUrl([x, x])).toEqual([x]);
  });
});
