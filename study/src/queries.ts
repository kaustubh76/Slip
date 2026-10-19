/**
 * The sample. Eight searches, each a plain shopping phrase in a different category, chosen before
 * any result was seen and kept in code so the sample cannot be quietly reshaped to flatter the
 * numbers. Channel3 returns at most 30 products per search and charges one credit for it, so this
 * is ~240 products for 8 credits — the spec asks for 150–200.
 *
 * Why these: each is a thing a person would actually ask an agent to buy, specific enough that the
 * results are one product rather than a category, and spread across goods where several retailers
 * plausibly carry the same item. Narrow, single-retailer categories would flatter the study by
 * leaving nothing to compare; wide ones ("gifts") would return a jumble that no agent would face.
 */

export interface SampleQuery {
  /** Stable file name for this query's snapshot. */
  readonly slug: string;
  readonly query: string;
  /** Why it is in the sample, for the report. */
  readonly note: string;
}

export const SAMPLE_QUERIES: readonly SampleQuery[] = [
  { slug: "trail-running-shoes", query: "trail running shoes", note: "footwear, many retailers" },
  {
    slug: "wireless-noise-cancelling-headphones",
    query: "wireless noise cancelling headphones",
    note: "electronics, branded",
  },
  { slug: "cast-iron-skillet", query: "cast iron skillet", note: "kitchen, long-lived catalogue" },
  { slug: "mens-merino-wool-socks", query: "mens merino wool socks", note: "apparel, low price" },
  { slug: "mechanical-keyboard", query: "mechanical keyboard", note: "electronics, accessories" },
  { slug: "yoga-mat", query: "yoga mat", note: "sporting goods, commodity" },
  {
    slug: "stainless-steel-water-bottle",
    query: "stainless steel water bottle",
    note: "commodity",
  },
  { slug: "office-desk-chair", query: "office desk chair", note: "furniture, higher price" },
] as const;

/** One credit per search. */
export const SAMPLE_CREDITS = SAMPLE_QUERIES.length;
export const RESULTS_PER_QUERY = 30;
