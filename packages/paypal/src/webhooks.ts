import type { GatewayEvent, PaymentGateway, WebhookRequest } from "@slip/domain";
import type { PayPalApi } from "./client.js";
import { text } from "./map.js";

/**
 * Webhooks: PayPal telling Slip what happened without being asked. Two halves, deliberately kept
 * apart.
 *
 * **Verification is a call** and happens before anything is read: PayPal checks the signature
 * against the raw bytes it sent, so the body is passed through untouched rather than re-encoded —
 * re-serialising JSON changes spacing and escapes, and the signature would stop matching. Anything
 * other than an explicit SUCCESS is false: a delivery Slip cannot verify is a delivery from
 * nobody, and acting on it would let anyone move a payment's state.
 *
 * **Interpretation is pure**, because the resolver re-runs it over stored events. It only ever
 * reports what PayPal said; the attempt id comes from `custom_id`, which is outside data, and the
 * application checks it against its own records before trusting it.
 */

export type WebhookOperations = Pick<PaymentGateway, "verifyWebhook" | "interpretWebhook">;

export interface WebhookOptions {
  /** PAYPAL_WEBHOOK_ID: the subscription these deliveries belong to. */
  webhookId: string;
}

/** The five headers PayPal signs a delivery with. Without all five there is nothing to check. */
const SIGNATURE_HEADERS = {
  auth_algo: "paypal-auth-algo",
  cert_url: "paypal-cert-url",
  transmission_id: "paypal-transmission-id",
  transmission_sig: "paypal-transmission-sig",
  transmission_time: "paypal-transmission-time",
} as const;

export function createWebhookOperations(
  api: PayPalApi,
  options: WebhookOptions,
): WebhookOperations {
  return {
    async verifyWebhook(request: WebhookRequest, signal): Promise<boolean> {
      const headers = normalise(request.headers);
      const fields: Record<string, string> = {};
      for (const [field, header] of Object.entries(SIGNATURE_HEADERS)) {
        const value = text(headers[header]);
        if (value === null) {
          return false;
        }
        fields[field] = value;
      }
      // The body must be JSON before it can be spliced into ours; it is a stranger's bytes.
      try {
        JSON.parse(request.rawBody);
      } catch {
        return false;
      }
      const body = `{${Object.entries(fields)
        .map(([field, value]) => `${JSON.stringify(field)}:${JSON.stringify(value)}`)
        .join(
          ",",
        )},"webhook_id":${JSON.stringify(options.webhookId)},"webhook_event":${request.rawBody}}`;
      const answer = await api.call(
        {
          path: "/v1/notifications/verify-webhook-signature",
          method: "POST",
          body,
        },
        signal,
      );
      if (answer.outcome !== "ok") {
        return false;
      }
      const verdict = (answer.body as { verification_status?: unknown } | null)
        ?.verification_status;
      return verdict === "SUCCESS";
    },

    interpretWebhook,
  };
}

interface PayPalResource {
  id?: unknown;
  custom_id?: unknown;
  invoice_id?: unknown;
  status?: unknown;
  status_details?: { reason?: unknown };
  customer?: { id?: unknown };
  metadata?: { order_id?: unknown; setup_token_id?: unknown };
  supplementary_data?: { related_ids?: { order_id?: unknown; authorization_id?: unknown } };
}

/**
 * One verified delivery, normalised. PayPal's own event names decide; a type Slip has no rule for,
 * or one missing the id its rule needs, is `ignored` — a webhook is never a reason to guess.
 */
/**
 * Every event type `interpretWebhook` acts on: what Slip's webhook subscription must include.
 * A subscription narrower than this loses money events silently.
 */
export const SLIP_WEBHOOK_EVENTS = [
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.CAPTURE.PENDING",
  "PAYMENT.CAPTURE.DENIED",
  "PAYMENT.CAPTURE.DECLINED",
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.AUTHORIZATION.VOIDED",
  "VAULT.PAYMENT-TOKEN.CREATED",
  "VAULT.PAYMENT-TOKEN.DELETED",
] as const;

export function interpretWebhook(payload: unknown): GatewayEvent {
  const event = payload as { event_type?: unknown; resource?: PayPalResource } | null;
  const eventType = text(event?.event_type) ?? "UNKNOWN";
  const resource = event?.resource ?? {};
  const id = text(resource.id);
  const attemptId = text(resource.custom_id);
  const orderId = text(resource.supplementary_data?.related_ids?.order_id);
  const ignored: GatewayEvent = { kind: "ignored", eventType };

  switch (eventType) {
    case "PAYMENT.CAPTURE.COMPLETED":
      return attemptId === null || id === null
        ? ignored
        : { kind: "capture-completed", attemptId, orderId, captureId: id };
    case "PAYMENT.CAPTURE.PENDING":
      return attemptId === null || id === null
        ? ignored
        : { kind: "capture-pending", attemptId, orderId, captureId: id };
    // PayPal sends DENIED for Payments v1 and DECLINED for v2; both mean the money did not move.
    case "PAYMENT.CAPTURE.DENIED":
    case "PAYMENT.CAPTURE.DECLINED":
      return attemptId === null
        ? ignored
        : {
            kind: "capture-declined",
            attemptId,
            captureId: id,
            reason: text(resource.status_details?.reason) ?? eventType,
          };
    case "PAYMENT.AUTHORIZATION.CREATED":
      return attemptId === null || id === null
        ? ignored
        : { kind: "authorization-created", attemptId, orderId, authorizationId: id };
    case "PAYMENT.AUTHORIZATION.VOIDED":
      return attemptId === null || id === null
        ? ignored
        : { kind: "authorization-voided", attemptId, authorizationId: id };
    case "VAULT.PAYMENT-TOKEN.CREATED":
      return id === null
        ? ignored
        : {
            kind: "vault-token-created",
            vaultId: id,
            customerId: text(resource.customer?.id),
            setupReference: text(resource.metadata?.setup_token_id),
          };
    case "VAULT.PAYMENT-TOKEN.DELETED":
      return id === null ? ignored : { kind: "vault-token-deleted", vaultId: id };
    default:
      // A refund, a dispute, an order approval: real events Slip has no rule for.
      return ignored;
  }
}

/** Header names arrive in whatever case the sender used; PayPal's own vary by delivery. */
function normalise(
  headers: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(headers)) {
    out[name.toLowerCase()] = value;
  }
  return out;
}
