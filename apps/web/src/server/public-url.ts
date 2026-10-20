/**
 * An address on Slip's own public URL. Redirects are built from it, never from the request's URL:
 * behind a tunnel or proxy, `next start` reconstructs `request.url` as `https://localhost:<port>`,
 * so a redirect built from it would send the owner somewhere that does not answer.
 */
export function publicUrl(publicBaseUrl: string, path: string): URL {
  const base = publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`;
  return new URL(path.replace(/^\/+/, ""), base);
}

/**
 * Slip's own address, as this deployment knows it: what the operator set, or what the host says
 * when they did not. `SLIP_BASE_URL` wins, because an operator who names an address means it —
 * behind a tunnel or a custom domain it is the only thing that can be right. Render names the
 * service's own `https://…onrender.com` in `RENDER_EXTERNAL_URL`, which is better than a guess.
 *
 * Empty when neither is set, which leaves every caller's own default in place: the config's
 * `http://localhost:3000`, and a cookie decided by `NODE_ENV` rather than by a scheme.
 */
export function publicBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const set = env["SLIP_BASE_URL"]?.trim() ?? "";
  return set !== "" ? set : (env["RENDER_EXTERNAL_URL"]?.trim() ?? "");
}
