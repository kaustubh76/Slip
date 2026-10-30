import { runResolver } from "@slip/app";
import { authoriseCron, cronSecrets } from "../../../../server/cron";
import { answer, jsonRoute } from "../../../../server/json";
import { logApiError } from "../../../../server/owner-route";
import { deps } from "../../../../server/runtime";

export const dynamic = "force-dynamic";
/** The resolver may wait on PayPal for several payments; Vercel's default would cut it short. */
export const maxDuration = 60;

/**
 * `POST /api/cron/resolve` (and GET, which is what Vercel's scheduler sends) — one pass of the
 * resolver: unknown payments finished, expired holds released, half-done revokes completed, setups
 * polled, failed webhooks re-run.
 *
 * A serverless deployment has no long-lived process to do this on a timer, and without it a hold
 * would never expire and an authorization could sit on someone's card until PayPal dropped it. See
 * `apps/web/src/server/cron.ts` for who is allowed to call it, and `apps/web/vercel.json` for the
 * schedule — it lives beside the app because Vercel reads its configuration from the project's
 * root directory, which for this workspace is `apps/web`.
 *
 * It answers with the resolver's own report, so a scheduler's logs show what moved.
 */
const resolve = jsonRoute(async (request: Request) => {
  const verdict = authoriseCron({
    authorization: request.headers.get("authorization"),
    secrets: cronSecrets(),
  });
  if (verdict === "unconfigured") {
    return answer(503, {
      status: "error",
      message: "Set SLIP_CRON_SECRET (or CRON_SECRET) and call this with it as a bearer token.",
    });
  }
  if (verdict === "unauthorized") {
    return answer(401, { status: "error", message: "Not Slip's scheduler." });
  }
  const report = await runResolver(await deps());
  return answer(200, { status: "ok", report });
}, logApiError);

export const POST = resolve;
export const GET = resolve;
