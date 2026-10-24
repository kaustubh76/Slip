import "server-only";

/**
 * Where a request says it came from, for the owner's writes.
 *
 * Until the hold decisions got REST endpoints, nothing Slip exposed over HTTP could be forged from
 * another site: every mutation was either a server action, which Next guards by comparing `Origin`
 * against the host, or an endpoint behind a bearer credential, which a browser cannot be made to
 * send. `POST /api/v1/holds/{id}/approve` and `/decline` are the first that carry only a cookie,
 * and `SameSite=Lax` was the whole of their defence (D83).
 *
 * **This is depth, not a credential.** D74 took out `x-vercel-cron` because anyone who can reach
 * the deployment can type a header; the same is true here, which is why this check sits *behind*
 * the session and can only narrow what an already-signed-in browser may be made to do. Nothing
 * becomes reachable because a header is absent.
 *
 * The rule is the one `/api/mcp` already applies to itself (`packages/mcp/src/endpoint.ts`):
 * **present must match, absent passes.** A browser always sends `Origin` on a POST; a platform
 * calling Slip server-to-server sends none, and these routes exist precisely so that it can.
 *
 * `Origin: null` is not the same as no origin. It is a browser declining to name the source — a
 * sandboxed frame, or a POST that was redirected across origins — so it is refused rather than
 * waved through on the technicality that it did not parse.
 */

export type OriginVerdict = "ok" | "foreign";

export function judgeOrigin(input: {
  origin: string | null;
  /** Hostnames this deployment answers to, as `originHosts` derives them from its base URL. */
  allowed: readonly string[];
}): OriginVerdict {
  const sent = (input.origin ?? "").trim();
  if (sent === "") {
    return "ok";
  }
  if (sent.toLowerCase() === "null") {
    return "foreign";
  }
  let hostname: string;
  try {
    hostname = new URL(sent).hostname;
  } catch {
    // A browser sends an origin Slip can parse. Anything else is a caller worth refusing.
    return "foreign";
  }
  return input.allowed.includes(hostname) ? "ok" : "foreign";
}
