/**
 * The errands: 21 real products from the market study, each named specifically enough that one
 * product in the catalogue is unambiguously the right one.
 *
 * Two rules decided this list, and both matter to what the benchmark can claim.
 *
 * **Every errand must be winnable and losable.** Each product has two or more comparable offers
 * with a real price difference, so an agent that compares can pay less and an agent that does not
 * can pay more. A product with one offer would score every agent identically.
 *
 * **No generic titles.** "Cast Iron Skillet" and "Yoga Mat" were dropped, though they had the
 * widest spreads: several catalogue entries match them, so an agent buying "a yoga mat" could buy
 * a different product and "overpaid" would mean nothing. The remaining titles name one thing.
 *
 * The task never mentions price, cheapness or comparison. Condition A asks whether an agent
 * compares offers when nothing tells it to; an errand that said "find the cheapest" would be
 * measuring instruction-following instead.
 */

export interface Errand {
  /** Stable file name for this errand's recorded runs. */
  readonly id: string;
  /** The Channel3 product the task names, for grading. */
  readonly productId: string;
  /** What the owner asks, in their own words. */
  readonly task: string;
}

export const ERRANDS: readonly Errand[] = [
  { id: "norda-001", productId: "mIZJLPA", task: "Order the Norda 001 Trail Running Shoes." },
  { id: "norda-002", productId: "9NdfLJ3", task: "Order the Norda 002 M Trail Running Shoes." },
  {
    id: "rush-2-pro-gtx",
    productId: "f8Dg2vn",
    task: "Order the Rush 2 Pro GTX Trail Running Shoes.",
  },
  { id: "trinity-fkt", productId: "ls8Tvwa", task: "Order the Trinity FKT Trail Running Shoes." },
  {
    id: "pegasus-trail",
    productId: "zr4B9BV",
    task: "Order the Nike ACG Pegasus Trail men's trail running shoes.",
  },
  {
    id: "topo-pursuit-3",
    productId: "7dy4Oon",
    task: "Order the Topo Athletic Pursuit 3 Trail Running Shoes.",
  },
  {
    id: "taytum-chair",
    productId: "QgVNPKc",
    task: "Order the Taytum Faux Leather Upholstered Mid-Back Executive Office Chair.",
  },
  {
    id: "rocking-leather-chair",
    productId: "l8XeZv8",
    task: "Order the Ergonomic Leather Office Chair with Rocking Function.",
  },
  { id: "lyncott-chair", productId: "fy2VzgO", task: "Order the Lyncott Home Office Desk Chair." },
  { id: "circa-3581", productId: "awGi5Qs", task: "Order the Circa 3581 Office Chair." },
  {
    id: "garvee-chair",
    productId: "w3RKdTx",
    task: "Order the Garvee Comfortable Office Desk Chair.",
  },
  { id: "lodge-skillet", productId: "a8bvjjd", task: "Order the Lodge Cast Iron Skillet." },
  {
    id: "lodge-chef-skillet",
    productId: "B7XotZl",
    task: "Order the Lodge Chef Collection Cast Iron Skillet.",
  },
  {
    id: "hunting-boot-socks",
    productId: "fkBA6Sh",
    task: "Order the Merino Wool Midweight Hunting Boot Socks.",
  },
  {
    id: "vintage-stripe-socks",
    productId: "QXkv3Xy",
    task: "Order the Wide Open Merino Wool Vintage Stripe Cushioned Crew Socks.",
  },
  {
    id: "geojug-bottle",
    productId: "etcDx0c",
    task: "Order the GEOJUG Stainless Steel Vacuum-Insulated Water Bottle.",
  },
  {
    id: "great-wave-bottle",
    productId: "S3nfI6e",
    task: "Order the Great Wave Stainless Steel Water Bottle.",
  },
  {
    id: "owala-freesip",
    productId: "dzojWma",
    task: "Order the Owala 24 oz FreeSip Stainless Steel Water Bottle.",
  },
  {
    id: "aonic-50",
    productId: "PrBYPvB",
    task: "Order the AONIC 50 GEN 2 Wireless Noise Cancelling Headphones.",
  },
  {
    id: "collexion-headphones",
    productId: "hIb2eu8",
    task: "Order The Collexion Wireless Noise Cancelling Headphones.",
  },
  {
    id: "logitech-k845",
    productId: "bSPSF3y",
    task: "Order the Logitech K845 Mechanical Illuminated Keyboard.",
  },
] as const;
