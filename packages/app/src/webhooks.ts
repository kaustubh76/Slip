import {
  attemptId,
  type GatewayEvent,
  isUuid,
  SlipError,
  SYSTEM_DECIDER,
  type WebhookEvent,
  type WebhookRequest,
} from "@slip/domain";
import { z } from "zod";
import type { AppDeps } from "./deps.js";
import { activateMandate, shutDown } from "./mandates.js";
import { afterWebhook, type PaymentWebhookEvent } from "./outcomes.js";
import { applyStep, callPayPal, releaseAuthorization } from "./payments.js";

/**
 * PayPal's webhooks: verified with PayPal, stored once by event id, then applied through the same
 * state machines as every other report. PayPal retries a delivery that does not get a 2xx for
 * three days, and may deliver late, twice or out of order; every effect here is a compare-and-set,
 * so any order and any number of deliveries converge on the same state.
 *
 * - `processed` / `duplicate` → 200. `rejected` → 400 (a forged or unreadable delivery).
 * - `retry` → 503: verification could not finish, or applying failed for a reason that may pass
 *   (the event is stored; PayPal redelivers and the resolver re-runs it).
 */
export type WebhookOutcome =
  | { status: "processed"; eventId: string }
  | { status: "duplicate"; eventId: string }
  | { status: "rejected"; reason: "BAD_SIGNATURE" | "MALFORMED" }
  | { status: "retry"; reason: string };

const EnvelopeSchema = z.object({
  id: z.string().min(1).max(255),
  event_type: z.string().min(1).max(255),
  resource: z.object({ id: z.string().optional() }).loose().optional(),
});

export async function receiveWebhook(
  deps: AppDeps,
  request: WebhookRequest,
): Promise<WebhookOutcome> {
  const verified = await callPayPal(deps, "webhook verification", (signal) =>
    deps.gateway.verifyWebhook(request, signal),
  );
  if (typeof verified !== "boolean") {
    return { status: "retry", reason: verified.reason };
  }
  if (!verified) {
    deps.log.warn("webhook.bad_signature", {});
    return { status: "rejected", reason: "BAD_SIGNATURE" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(request.rawBody);
  } catch {
    return { status: "rejected", reason: "MALFORMED" };
  }
  const envelope = EnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return { status: "rejected", reason: "MALFORMED" };
  }
  const { id, event_type: eventType, resource } = envelope.data;
  const stored = await deps.store.webhooks.recordOnce({
    id,
    eventType,
    resourceId: resource?.id ?? null,
    payload,
    receivedAt: deps.clock.now(),
  });
  if (!stored.inserted && stored.processedAt !== null) {
    return { status: "duplicate", eventId: id };
  }
  try {
    await processWebhook(deps, { id, payload });
  } catch (error) {
    deps.log.error("webhook.failed", { eventId: id, error: String(error) });
    return { status: "retry", reason: "processing failed; stored for a retry" };
  }
  return { status: "processed", eventId: id };
}

/**
 * Applies one stored event and marks it processed. An event that can never apply (Slip refuses
 * it on purpose: a conflict, an impossible move) is logged for a human and marked processed, so
 * it is not retried for ever; anything else throws and the event stays unprocessed.
 */
export async function processWebhook(
  deps: AppDeps,
  event: Pick<WebhookEvent, "id" | "payload">,
): Promise<void> {
  let normalised: GatewayEvent;
  try {
    normalised = deps.gateway.interpretWebhook(event.payload);
  } catch (error) {
    // Interpretation is pure: it would fail the same way every time.
    deps.log.error("webhook.uninterpretable", { eventId: event.id, error: String(error) });
    normalised = { kind: "ignored", eventType: "UNINTERPRETABLE" };
  }
  try {
    await apply(deps, event.id, normalised);
  } catch (error) {
    if (!(error instanceof SlipError)) {
      throw error;
    }
    deps.log.error("webhook.unprocessable", {
      eventId: event.id,
      kind: normalised.kind,
      code: error.code,
      error: error.message,
    });
  }
  await deps.store.webhooks.markProcessed(event.id, deps.clock.now());
}

async function apply(deps: AppDeps, eventId: string, event: GatewayEvent): Promise<void> {
  switch (event.kind) {
    case "capture-completed":
    case "capture-pending":
    case "capture-declined":
    case "authorization-created":
    case "authorization-voided":
      return applyToPayment(deps, eventId, event);
    case "vault-token-created":
      return vaultCreated(deps, eventId, event);
    case "vault-token-deleted":
      return vaultDeleted(deps, eventId, event);
    case "ignored":
      deps.log.info("webhook.ignored", { eventId, eventType: event.eventType });
      return;
  }
}

async function applyToPayment(
  deps: AppDeps,
  eventId: string,
  event: PaymentWebhookEvent,
): Promise<void> {
  // `custom_id` is outside data until it matches a payment Slip made.
  const payment = isUuid(event.attemptId)
    ? await deps.store.payments.get(attemptId(event.attemptId))
    : null;
  if (payment === null) {
    deps.log.warn("webhook.unknown_payment", { eventId, kind: event.kind });
    return;
  }
  const after = await applyStep(deps, payment, afterWebhook(payment, event), `webhook ${eventId}`);
  if (after.status !== "AUTHORIZED") {
    return;
  }
  // The owner declined, or the hold expired, before PayPal confirmed: release it now.
  const hold = await deps.store.holds.get(after.attemptId);
  if (hold?.status === "DECLINED" || hold?.status === "EXPIRED") {
    await releaseAuthorization(deps, after, "hold closed before PayPal confirmed");
  }
}

/** A saved payment method from a setup: activates its mandate (or deletes it after a revoke). */
async function vaultCreated(
  deps: AppDeps,
  eventId: string,
  event: Extract<GatewayEvent, { kind: "vault-token-created" }>,
): Promise<void> {
  const mandate =
    event.setupReference === null
      ? null
      : await deps.store.mandates.findBySetupOrderId(event.setupReference);
  if (mandate === null) {
    const known = (await deps.store.mandates.findByVaultId(event.vaultId)) !== null;
    deps.log[known ? "info" : "warn"]("webhook.vault_without_setup", { eventId, known });
    return;
  }
  await activateMandate(deps, mandate.id, { vaultId: event.vaultId, customerId: event.customerId });
}

/**
 * The saved method is gone at PayPal. After Slip's own revoke this is the confirmation. Otherwise
 * the owner removed Slip from their PayPal account, which is a revoke too: Slip stops at once.
 */
async function vaultDeleted(
  deps: AppDeps,
  eventId: string,
  event: Extract<GatewayEvent, { kind: "vault-token-deleted" }>,
): Promise<void> {
  const mandate = await deps.store.mandates.findByVaultId(event.vaultId);
  if (mandate === null) {
    deps.log.warn("webhook.unknown_vault", { eventId });
    return;
  }
  if (mandate.status !== "REVOKED") {
    deps.log.info("mandate.revoked_at_paypal", { mandateId: mandate.id, eventId });
  }
  await shutDown(deps, mandate.id, SYSTEM_DECIDER, { vaultGone: true });
}
