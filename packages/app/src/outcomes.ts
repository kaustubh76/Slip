import type {
  AuthorizationResult,
  CaptureResult,
  OrderResult,
  PaymentIntent,
  PaymentPatch,
  PaymentStatus,
  VoidResult,
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
