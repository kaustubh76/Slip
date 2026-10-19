import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Who may run Slip's housekeeping.
 *
 * A long-lived process finishes its own loose ends on a timer (D66), but a serverless instance
 * lives for one request, so something outside has to ask. That makes the resolver reachable over
 * HTTP, and the resolver captures holds and voids authorizations — so the endpoint needs a
 * credential, not obscurity.
 *
 * Two ways in. `SLIP_CRON_SECRET` as a bearer token is the general one, compared in constant time
 * so the comparison cannot be timed character by character. Vercel's own scheduler cannot send a
 * header of ours, so its `x-vercel-cron` marker is accepted too — but only when no secret is set,
 * because that header is trivially forgeable by anyone who can reach the deployment, and a
 * deployment that has chosen a secret should not also accept a weaker proof.
 */

export type CronVerdict = "ok" | "unauthorized" | "unconfigured";

export function authoriseCron(input: {
  authorization: string | null;
  vercelCron: string | null;
  secret: string | undefined;
}): CronVerdict {
  const secret = input.secret?.trim() ?? "";
  if (secret === "") {
    // Nothing to check against. Vercel's scheduler is allowed through so a deployment there works
    // out of the box; anywhere else this endpoint stays shut until a secret exists.
    return input.vercelCron === null ? "unconfigured" : "ok";
  }
  const offered = (input.authorization ?? "").trim();
  const bearer = offered.toLowerCase().startsWith("bearer ") ? offered.slice(7).trim() : offered;
  return sameSecret(bearer, secret) ? "ok" : "unauthorized";
}

/** Constant time in the length that matters, and never throws on a mismatched length. */
function sameSecret(offered: string, expected: string): boolean {
  const a = Buffer.from(offered);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}
