/**
 * How a store is named in a sentence: its domain without `www.`. The test and demo fixtures'
 * `store-a.example` reads as "Store A", so recorded demos say what a person would.
 */
export function storeName(domain: string): string {
  const bare = domain.toLowerCase().replace(/^www\./, "");
  const fixture = /^store-([a-z0-9]+)\.example$/.exec(bare);
  return fixture?.[1] === undefined ? bare : `Store ${fixture[1].toUpperCase()}`;
}
