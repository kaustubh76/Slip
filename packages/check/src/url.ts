/** Tracking and affiliate query keys that never identify a listing. */
const DROPPED_QUERY_KEYS: ReadonlySet<string> = new Set([
  "ref",
  "tag",
  "affid",
  "clickid",
  "fbclid",
  "gclid",
  "msclkid",
]);

function isDroppedQueryKey(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith("utm_") || DROPPED_QUERY_KEYS.has(lower);
}

function parseHttpUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return null;
  }
  return url;
}

/** Lower-case host without a leading `www.`. */
export function normalizeDomain(host: string): string {
  const lower = host.trim().toLowerCase();
  return lower.startsWith("www.") ? lower.slice(4) : lower;
}

/** The normalised domain of an http(s) URL, or `null` when the string is not one. */
export function domainOf(input: string): string | null {
  const url = parseHttpUrl(input);
  return url === null ? null : normalizeDomain(url.hostname);
}

/**
 * A canonical form of a listing URL so the same listing matches across `www.`, scheme,
 * tracking parameters, query order, fragments and trailing slashes. Returns `null` for anything
 * that is not an http(s) URL. The result has no scheme: `store.example/p/1?size=m`.
 */
export function normalizeOfferUrl(input: string): string | null {
  const url = parseHttpUrl(input);
  if (url === null) {
    return null;
  }
  const host = normalizeDomain(url.hostname);
  const port = url.port === "" ? "" : `:${url.port}`;
  let path = url.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isDroppedQueryKey(key))
    .sort(([keyA, valueA], [keyB, valueB]) => {
      if (keyA !== keyB) {
        return keyA < keyB ? -1 : 1;
      }
      if (valueA !== valueB) {
        return valueA < valueB ? -1 : 1;
      }
      return 0;
    });
  const query = new URLSearchParams(params).toString();
  return `${host}${port}${path}${query === "" ? "" : `?${query}`}`;
}
