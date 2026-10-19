/**
 * An address on Slip's own public URL. Redirects are built from it, never from the request's URL:
 * behind a tunnel or proxy, `next start` reconstructs `request.url` as `https://localhost:<port>`,
 * so a redirect built from it would send the owner somewhere that does not answer.
 */
export function publicUrl(publicBaseUrl: string, path: string): URL {
  const base = publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`;
  return new URL(path.replace(/^\/+/, ""), base);
}
