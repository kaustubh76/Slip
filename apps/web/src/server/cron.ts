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
 * **One way in: a bearer token, always.** With no secret set the endpoint stays shut (503):
 * housekeeping on a long-lived process runs on a timer instead (D66), and an endpoint that
 * captures holds and voids authorizations is not left open merely because nobody configured it.
 *
 * **Two names, and either is accepted.** `SLIP_CRON_SECRET` is Slip's own; `CRON_SECRET` is the
 * one Vercel injects as a bearer into its scheduled calls, and the *only* one it will send. They
 * are accepted equally, because preferring Slip's own name is how a Vercel deployment that
 * followed the documentation ends up answering 401 to its own scheduler for ever, with nothing
 * expiring a hold and real authorizations sitting on real cards (D76). `unsafeCombination` is
 * what insists on the right one where it matters.
 *
 * Secrets are compared in constant time, so one cannot be guessed a character at a time. An empty
 * or blank value is no secret at all, rather than a secret that shadows the other name.
 *
 * `x-vercel-cron` used to be accepted when no secret was set. Anyone who can reach the deployment
 * can type that header, so that was an unauthenticated way to move money, and it is gone (D74).
 */

export type CronVerdict = "ok" | "unauthorized" | "unconfigured";

export function cronSecrets(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return [env["SLIP_CRON_SECRET"], env["CRON_SECRET"]]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value !== "");
}

export function authoriseCron(input: {
  authorization: string | null;
  secrets: readonly string[];
}): CronVerdict {
  if (input.secrets.length === 0) {
    return "unconfigured";
  }
  const offered = (input.authorization ?? "").trim();
  const bearer = offered.toLowerCase().startsWith("bearer ") ? offered.slice(7).trim() : offered;
  // Trimmed on both sides: `cronSecrets` already does it, but a secret pasted into a dashboard
  // with a stray space must not be a secret nobody can present.
  return input.secrets.some((secret) => sameSecret(bearer, secret.trim())) ? "ok" : "unauthorized";
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
