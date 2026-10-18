import type {
  AuthorizationResult,
  AuthorizationStatus,
  CaptureResult,
  Cents,
  OrderResult,
} from "@slip/domain";
import { AUTHORIZATION_STATUSES } from "@slip/domain";

/**
 * PayPal's payloads turned into the port's vocabulary. Everything here is pure, so the mapping of
 * each documented shape is a table test rather than a live call.
 *
 * The one rule that matters: **a shape Slip cannot read is never a success.** An order whose
 * payment state cannot be identified comes back as `pending` when PayPal has clearly accepted it
 * (so the resolver keeps watching it), and never as `captured`.
 */

/** `1299` → `"12.99"`, the string PayPal wants. */
export function usd(amount: Cents): string {
  return `${Math.floor(amount / 100)}.${String(amount % 100).padStart(2, "0")}`;
}

interface PayPalMoney {
  currency_code?: unknown;
  value?: unknown;
}

interface PayPalCapture {
  id?: unknown;
  status?: unknown;
  invoice_id?: unknown;
  custom_id?: unknown;
  amount?: PayPalMoney;
  supplementary_data?: { related_ids?: Related };
}

interface PayPalAuthorization {
  id?: unknown;
  status?: unknown;
  invoice_id?: unknown;
  custom_id?: unknown;
  amount?: PayPalMoney;
  supplementary_data?: { related_ids?: Related };
}

interface Related {
  order_id?: unknown;
  authorization_id?: unknown;
  capture_id?: unknown;
}

interface PayPalOrder {
  id?: unknown;
  status?: unknown;
  intent?: unknown;
  links?: unknown;
  purchase_units?: {
    payments?: { captures?: PayPalCapture[]; authorizations?: PayPalAuthorization[] };
  }[];
}

/** A capture that has taken the money, or is on its way to. */
const CAPTURE_HELD = ["COMPLETED", "REFUNDED", "PARTIALLY_REFUNDED"];

/**
 * One order as PayPal describes it. A refunded capture counts as `captured`: the money moved, and
 * a refund is outside what Slip models — calling it anything else would say the charge never
 * happened.
 */
export function orderResult(body: unknown): OrderResult | null {
  const order = body as PayPalOrder | null;
  const id = text(order?.id);
  if (id === null) {
    return null;
  }
  const status = text(order?.status);
  const payments = order?.purchase_units?.[0]?.payments;
  const capture = payments?.captures?.[0];
  const authorization = payments?.authorizations?.[0];
  const captureId = text(capture?.id);
  const authorizationId = text(authorization?.id);

  if (status === "PAYER_ACTION_REQUIRED") {
    // The vaulted method needs the owner at PayPal again. Nothing was charged.
    return { kind: "payer-action-required", orderId: id, approveUrl: approveUrl(order?.links) };
  }
  if (capture !== undefined && captureId !== null) {
    const captureStatus = text(capture.status) ?? "";
    if (CAPTURE_HELD.includes(captureStatus)) {
      return { kind: "captured", orderId: id, captureId };
    }
    if (captureStatus === "PENDING") {
      return { kind: "pending", orderId: id, captureId, authorizationId };
    }
    return { kind: "declined", orderId: id, reason: `CAPTURE_${captureStatus || "UNKNOWN"}` };
  }
  if (authorization !== undefined && authorizationId !== null) {
    switch (text(authorization.status)) {
      case "CREATED":
        return { kind: "authorized", orderId: id, authorizationId };
      case "CAPTURED":
      case "PARTIALLY_CAPTURED": {
        // Captured, but this payload does not carry the capture: `related_ids` usually does.
        const related = text(authorization.supplementary_data?.related_ids?.capture_id);
        return related === null
          ? { kind: "pending", orderId: id, captureId: null, authorizationId }
          : { kind: "captured", orderId: id, captureId: related };
      }
      case "VOIDED":
      case "EXPIRED":
        return { kind: "voided", orderId: id, authorizationId };
      case "DENIED":
        return { kind: "declined", orderId: id, reason: "AUTHORIZATION_DENIED" };
      default:
        return { kind: "pending", orderId: id, captureId: null, authorizationId };
    }
  }
  // An order with no payment yet: PayPal has it, so the resolver watches it rather than resending.
  return status === "VOIDED"
    ? { kind: "declined", orderId: id, reason: "ORDER_VOIDED" }
    : { kind: "pending", orderId: id, captureId: null, authorizationId: null };
}

/** One capture as PayPal describes it, for the capture of a hold's authorization. */
export function captureResult(body: unknown): CaptureResult | null {
  const capture = body as PayPalCapture | null;
  const id = text(capture?.id);
  if (id === null) {
    return null;
  }
  const status = text(capture?.status) ?? "";
  if (CAPTURE_HELD.includes(status)) {
    return { kind: "captured", captureId: id };
  }
  if (status === "PENDING") {
    return { kind: "pending", captureId: id };
  }
  return { kind: "declined", reason: `CAPTURE_${status || "UNKNOWN"}` };
}

/** One authorization as PayPal describes it: the hold's own state, and its capture if it has one. */
export function authorizationResult(body: unknown): AuthorizationResult | null {
  const authorization = body as PayPalAuthorization | null;
  const status = text(authorization?.status);
  if (status === null || !isAuthorizationStatus(status)) {
    return null;
  }
  return {
    kind: "found",
    status,
    captureId: text(authorization?.supplementary_data?.related_ids?.capture_id),
  };
}

export function isAuthorizationStatus(value: string): value is AuthorizationStatus {
  return (AUTHORIZATION_STATUSES as readonly string[]).includes(value);
}

/** Where PayPal sends the owner to approve something. */
export function approveUrl(links: unknown): string | null {
  if (!Array.isArray(links)) {
    return null;
  }
  const wanted = ["payer-action", "approve"];
  for (const rel of wanted) {
    const link = links.find((candidate) => (candidate as { rel?: unknown } | null)?.rel === rel) as
      | { href?: unknown }
      | undefined;
    const href = text(link?.href);
    if (href !== null) {
      return href;
    }
  }
  return null;
}

/** A non-empty string, or null: PayPal omits fields rather than sending empty ones. */
export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
