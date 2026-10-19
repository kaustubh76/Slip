import { logApiError } from "../../../../server/owner-route";
import { handlePayPalWebhook } from "../../../../server/paypal-webhook";
import { deps } from "../../../../server/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * `POST /api/webhooks/paypal` — where PayPal reports what became of orders, captures,
 * authorizations and saved payment methods. No session or key: every delivery is verified with
 * PayPal itself (`verify-webhook-signature`, against this deployment's webhook id) before it is
 * applied, and applying is idempotent, so a replayed or forged delivery changes nothing.
 */
export async function POST(request: Request): Promise<Response> {
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
