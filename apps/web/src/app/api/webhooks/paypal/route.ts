import { logApiError } from "../../../../server/owner-route";
import { handlePayPalWebhook } from "../../../../server/paypal-webhook";
import { deps, SERVICES } from "../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `POST /api/webhooks/paypal` — where PayPal reports what became of orders, captures,
 * authorizations and saved payment methods. No session or key: every delivery is verified with
 * PayPal itself (`verify-webhook-signature`, against this deployment's webhook id) before it is
 * applied, and applying is idempotent, so a replayed or forged delivery changes nothing.
 *
 * **Only where there is a PayPal to verify against.** With the payment stand-in there is no
 * signature to check — its verifier answers to a header anyone can type — and nothing is
 * delivering anyway, since the stand-in runs in this process. So the door is not there at all
 * rather than open: a deployment without PayPal's keys answers 404 (D74).
 */
export async function POST(request: Request): Promise<Response> {
  if (SERVICES.payment === "simulated") {
    return Response.json(
      { status: "rejected", reason: "NO_PAYPAL" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    return await handlePayPalWebhook(await deps(), request);
  } catch (error) {
    logApiError(error);
    return Response.json(
      { status: "retry" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
