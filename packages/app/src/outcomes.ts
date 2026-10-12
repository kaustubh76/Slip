import {
  type AuthorizationResult,
  type CaptureResult,
  type GatewayEvent,
  missingPaymentFields,
  type OrderLookupResult,
  type OrderResult,
  type Payment,
  type PaymentIntent,
  type PaymentPatch,
  type PaymentStatus,
  type VoidResult,
} from "@slip/domain";

/**
 * What to do with the payment after PayPal answered. Pure: no I/O, so every answer PayPal can give
 * is tested against the payment state machines once, here.
 *
 * - `move`: record this status and these PayPal ids.
 * - `stay`: nothing is known yet; keep the status and try again later (same request id).
 * - `check-authorization`: a capture was declined; ask whether the authorization is still alive.
 * - `void`: the authorization is alive but must be released (VOIDING with a new request id).
 * - `contradiction`: PayPal says something impossible for this payment; a human must look.
 */
export type Step =
  | { kind: "move"; to: PaymentStatus; patch: PaymentPatch; detail: Record<string, unknown> }
  | { kind: "stay"; why: string }
  | { kind: "check-authorization"; why: string }
  | { kind: "void"; why: string }
  | { kind: "contradiction"; why: string };

const move = (to: PaymentStatus, patch: PaymentPatch, detail: Record<string, unknown>): Step => ({
  kind: "move",
  to,
  patch,
  detail,
});

/** After creating (or re-sending, or looking up) the order of an INITIATED/UNKNOWN payment. */
export function afterOrder(intent: PaymentIntent, result: OrderResult): Step {
  const detail = { source: "order", paypal: result.kind };
  switch (result.kind) {
    case "captured":
      return intent === "CAPTURE"
        ? move("CAPTURED", { paypalOrderId: result.orderId, captureId: result.captureId }, detail)
        : { kind: "contradiction", why: "an authorize order came back captured" };
    case "authorized":
      return intent === "AUTHORIZE"
        ? move(
            "AUTHORIZED",
            { paypalOrderId: result.orderId, authorizationId: result.authorizationId },
            detail,
          )
        : { kind: "contradiction", why: "a one-step order came back authorized" };
    case "voided":
      return intent === "AUTHORIZE"
        ? move(
            "VOIDED",
            { paypalOrderId: result.orderId, authorizationId: result.authorizationId },
            detail,
          )
        : { kind: "contradiction", why: "a one-step order came back voided" };
    case "pending": {
      const patch: PaymentPatch = { paypalOrderId: result.orderId };
      if (intent === "CAPTURE" && result.captureId !== null) {
        patch.captureId = result.captureId;
      }
      if (intent === "AUTHORIZE" && result.authorizationId !== null) {
        patch.authorizationId = result.authorizationId;
      }
      return move("PENDING", patch, detail);
    }
    case "declined":
      return move(
        "FAILED",
        {
          failureReason: result.reason,
          ...(result.orderId === null ? {} : { paypalOrderId: result.orderId }),
        },
        detail,
      );
    case "payer-action-required":
      return move(
        "FAILED",
        {
          failureReason: "PAYER_ACTION_REQUIRED",
          ...(result.orderId === null ? {} : { paypalOrderId: result.orderId }),
        },
        { ...detail, approveUrl: result.approveUrl },
      );
    case "duplicate-invoice":
      // An order for this attempt already exists at PayPal: find it, never fail it.
      return move("UNKNOWN", {}, { ...detail, reason: result.reason });
    case "unknown":
      return move("UNKNOWN", {}, { ...detail, reason: result.reason });
  }
}

/** After reading an order PayPal already knows by id (a PENDING one, or one looked up before). */
export function afterOrderRead(intent: PaymentIntent, result: OrderResult): Step {
  // Not being able to read it says nothing about the payment.
  return result.kind === "unknown"
    ? { kind: "stay", why: result.reason }
    : afterOrder(intent, result);
}

/**
 * After searching PayPal's records for the order of an INITIATED/UNKNOWN payment. "Not found"
 * fails it only once `canGiveUp` (long enough after the decision that the order would show); an
 * unanswered search never does.
 */
export function afterLookup(
  intent: PaymentIntent,
  result: OrderLookupResult,
  canGiveUp: boolean,
): Step {
  switch (result.kind) {
    case "found":
      return afterOrderRead(intent, result.order);
    case "not-found":
      return canGiveUp
        ? move(
            "FAILED",
            { failureReason: "ORDER_NOT_FOUND" },
            { source: "lookup", paypal: "not-found" },
          )
        : { kind: "stay", why: "no order found yet" };
    case "unknown":
      return { kind: "stay", why: result.reason };
  }
}

/** After capturing the authorization of a CAPTURING payment. */
export function afterCapture(result: CaptureResult): Step {
  const detail = { source: "capture", paypal: result.kind };
  switch (result.kind) {
    case "captured":
      return move("CAPTURED", { captureId: result.captureId }, detail);
    case "pending":
      // Stays CAPTURING until PayPal settles it; the capture id is recorded now.
      return move("CAPTURING", { captureId: result.captureId }, detail);
    case "declined":
      return { kind: "check-authorization", why: `capture declined: ${result.reason}` };
    case "unknown":
      return { kind: "stay", why: result.reason };
  }
}

/**
 * After reading the authorization of a CAPTURING or VOIDING payment (a declined capture, or an
 * operation whose re-send window has passed).
 */
export function afterAuthorizationCheck(
  current: "CAPTURING" | "VOIDING",
  result: AuthorizationResult,
): Step {
  if (result.kind === "unknown") {
    return { kind: "stay", why: result.reason };
  }
  const detail = { source: "authorization", paypal: result.status };
  switch (result.status) {
    case "CAPTURED":
    case "PARTIALLY_CAPTURED":
      if (result.captureId === null) {
        return { kind: "stay", why: "captured without a capture id yet" };
      }
      return current === "CAPTURING"
        ? move("CAPTURED", { captureId: result.captureId }, detail)
        : { kind: "contradiction", why: "an authorization being voided was captured" };
    case "VOIDED":
    case "EXPIRED":
      return move("VOIDED", {}, detail);
    case "DENIED":
      return current === "CAPTURING"
        ? move("FAILED", { failureReason: "AUTHORIZATION_DENIED" }, detail)
        : move("VOIDED", {}, detail);
    case "CREATED":
    case "PENDING":
      return current === "CAPTURING"
        ? { kind: "void", why: "the capture failed but the authorization still holds funds" }
        : { kind: "stay", why: "the void has not landed yet" };
  }
}

/** After voiding the authorization of a VOIDING payment. */
export function afterVoid(result: VoidResult): Step {
  switch (result.kind) {
    case "voided":
      return move("VOIDED", {}, { source: "void", paypal: "voided" });
    case "not-voidable":
      if (result.status === "VOIDED" || result.status === "EXPIRED" || result.status === "DENIED") {
        return move("VOIDED", {}, { source: "void", paypal: result.status });
      }
      if (result.status === "CAPTURED" || result.status === "PARTIALLY_CAPTURED") {
        return { kind: "contradiction", why: "the authorization was captured, not voided" };
      }
      return { kind: "stay", why: `authorization is ${result.status}` };
    case "unknown":
      return { kind: "stay", why: result.reason };
  }
}

/** A webhook about one payment (it carries the attempt id PayPal echoes as `custom_id`). */
export type PaymentWebhookEvent = Extract<GatewayEvent, { attemptId: string }>;

/**
 * After a verified webhook about one payment. PayPal delivers late, twice and out of order, so an
 * event behind the payment's status is left to the state machine (stale, a no-op); one that needs
 * a PayPal id Slip does not have yet waits for the resolver's lookup; one that cannot fit the
 * payment at all is a contradiction for a human.
 */
export function afterWebhook(payment: Payment, event: PaymentWebhookEvent): Step {
  const detail = { source: "webhook", paypal: event.kind };
  const { intent, status } = payment;
  const orderId =
    "orderId" in event && event.orderId !== null ? { paypalOrderId: event.orderId } : {};
  const late = (why: string): Step => ({ kind: "stay", why: `${why} while ${status}` });

  let step: Step;
  switch (event.kind) {
    case "capture-completed":
      step = move("CAPTURED", { captureId: event.captureId, ...orderId }, detail);
      break;
    case "capture-pending":
      if (intent === "CAPTURE") {
        step = move("PENDING", { captureId: event.captureId, ...orderId }, detail);
      } else if (status === "CAPTURING") {
        step = move("CAPTURING", { captureId: event.captureId }, detail);
      } else {
        step = settledAuthorization(status)
          ? late("capture pending")
          : { kind: "contradiction", why: `a capture Slip did not start, while ${status}` };
      }
      break;
    case "capture-declined":
      if (intent === "CAPTURE") {
        step = move("FAILED", { failureReason: event.reason }, detail);
      } else if (status === "CAPTURING") {
        step = { kind: "check-authorization", why: `capture declined: ${event.reason}` };
      } else {
        step = late("capture declined");
      }
      break;
    case "authorization-created":
      step =
        intent === "AUTHORIZE"
          ? move("AUTHORIZED", { authorizationId: event.authorizationId, ...orderId }, detail)
          : { kind: "contradiction", why: "a one-step payment reported an authorization" };
      break;
    case "authorization-voided":
      step =
        intent === "AUTHORIZE"
          ? move("VOIDED", { authorizationId: event.authorizationId }, detail)
          : { kind: "contradiction", why: "a one-step payment reported a voided authorization" };
      break;
  }

  if (step.kind === "move") {
    const fields = {
      paypalOrderId: step.patch.paypalOrderId ?? payment.paypalOrderId,
      authorizationId: step.patch.authorizationId ?? payment.authorizationId,
      captureId: step.patch.captureId ?? payment.captureId,
      failureReason: step.patch.failureReason ?? payment.failureReason,
    };
    const missing = missingPaymentFields(step.to, fields);
    if (missing.length > 0) {
      return {
        kind: "stay",
        why: `${step.to} needs ${missing.join(", ")}; the lookup will find it`,
      };
    }
  }
  return step;
}

/** Statuses in which a hold's authorization is already finished with. */
function settledAuthorization(status: PaymentStatus): boolean {
  return (
    status === "CAPTURED" || status === "VOIDING" || status === "VOIDED" || status === "FAILED"
  );
}
