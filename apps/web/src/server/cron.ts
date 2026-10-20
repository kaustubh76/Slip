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
 * **One way in: a bearer token, always.** The secret is `SLIP_CRON_SECRET`, or `CRON_SECRET` —
 * the name Vercel injects into its own scheduled calls — so a serverless deployment can be both
 * scheduled and authenticated. It is compared in constant time, so it cannot be guessed a
 * character at a time. With no secret set the endpoint stays shut (503): housekeeping on a
 * long-lived process runs on a timer instead (D66), and an endpoint that captures holds and voids
 * authorizations is not left open merely because nobody configured it.
 *
 * `x-vercel-cron` used to be accepted when no secret was set. Anyone who can reach the deployment
 * can type that header, so that was an unauthenticated way to move money, and it is gone (D74).
 */

export type CronVerdict = "ok" | "unauthorized" | "unconfigured";

export function cronSecret(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env["SLIP_CRON_SECRET"] ?? env["CRON_SECRET"];
}

export function authoriseCron(input: {
  authorization: string | null;
  secret: string | undefined;
}): CronVerdict {
  const secret = input.secret?.trim() ?? "";
  if (secret === "") {
    return "unconfigured";
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
