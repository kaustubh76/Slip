import { type AppDeps, receiveWebhook } from "@slip/app";

/**
 * PayPal's webhook deliveries, as an HTTP answer. The body is read raw and passed on byte for
 * byte: PayPal's verification signs exactly what it sent. What the answer says matters to PayPal,
 * which retries anything but a 2xx for three days:
 *
 * - 200: applied, or already applied (a redelivery).
 * - 400: a forged or unreadable delivery; retrying it cannot help.
 * - 503: verification could not finish, or applying failed for a reason that may pass; the event
 *   is stored, PayPal redelivers, and the resolver re-runs it.
 * - 413: a body no PayPal event comes near.
 *
 * Only the event id and the outcome are logged, never the body: it can carry a payer's details.
 */

export const MAX_WEBHOOK_BYTES = 256 * 1024;

export async function handlePayPalWebhook(
  deps: AppDeps,
  request: Request,
  maxBytes = MAX_WEBHOOK_BYTES,
): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return answer(413, { status: "rejected", reason: "TOO_LARGE" });
  }
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > maxBytes) {
    return answer(413, { status: "rejected", reason: "TOO_LARGE" });
  }
  // Header names arrive lower-cased from the Fetch API, as PayPal's verification expects them.
  const headers = Object.fromEntries(request.headers);
  const outcome = await receiveWebhook(deps, { headers, rawBody });
  deps.log.info("webhook.received", {
    status: outcome.status,
    ...("eventId" in outcome ? { eventId: outcome.eventId } : {}),
    ...("reason" in outcome ? { reason: outcome.reason } : {}),
  });
  switch (outcome.status) {
    case "processed":
    case "duplicate":
      return answer(200, { status: outcome.status });
    case "rejected":
      return answer(400, { status: "rejected", reason: outcome.reason });
    case "retry":
      return answer(503, { status: "retry" });
  }
}

function answer(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
