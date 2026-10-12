import type { AttemptId, MandateId, RequestId } from "../ids.js";
import type { Cents } from "../money.js";
import type { PaymentIntent } from "../payment.js";

/**
 * The payment processor (PayPal in production), as the application needs it. Every call that
 * reaches the processor takes an `AbortSignal`; expected outcomes — declines, timeouts, "not
 * found" — are results, never exceptions, so no caller can forget the "we don't know" case.
 *
 * `unknown` always means: the request may or may not have taken effect. The caller keeps the
 * write-ahead status and finishes it later with the same request id, never with a new one.
 */

export interface CreateOrderInput {
  intent: PaymentIntent;
  vaultId: string;
  amountCents: Cents;
  /** PayPal-Request-Id: the ORDER operation's id, identical on every retry. */
  requestId: RequestId;
  /** Sent as both `custom_id` and `invoice_id`, so every PayPal record points at the attempt. */
  invoiceId: AttemptId;
  /** Shown to the payer; the adapter truncates to PayPal's limit. */
  description: string;
}

export type OrderResult =
  | { kind: "captured"; orderId: string; captureId: string }
  | {
      kind: "pending";
      orderId: string;
      captureId: string | null;
      authorizationId: string | null;
    }
  | { kind: "authorized"; orderId: string; authorizationId: string }
  | { kind: "voided"; orderId: string; authorizationId: string }
  | { kind: "declined"; orderId: string | null; reason: string }
  /** The vaulted method needs the owner again (re-approval); nothing was charged. */
  | { kind: "payer-action-required"; orderId: string | null; approveUrl: string | null }
  /** PayPal refused a second order for this invoice id: look the first one up, never FAIL. */
  | { kind: "duplicate-invoice"; reason: string }
  | { kind: "unknown"; reason: string };

export type OrderLookupResult =
  | { kind: "found"; order: OrderResult }
  | { kind: "not-found" }
  | { kind: "unknown"; reason: string };

export interface FindOrderInput {
  invoiceId: AttemptId;
  amountCents: Cents;
  /** Search window; reporting lags up to ~3 h behind real time. */
  from: Date;
  to: Date;
}

export const AUTHORIZATION_STATUSES = [
  "CREATED",
  "PENDING",
  "CAPTURED",
  "PARTIALLY_CAPTURED",
  "VOIDED",
  "EXPIRED",
  "DENIED",
] as const;
export type AuthorizationStatus = (typeof AUTHORIZATION_STATUSES)[number];

export type AuthorizationResult =
  | { kind: "found"; status: AuthorizationStatus; captureId: string | null }
  | { kind: "unknown"; reason: string };

export interface CaptureAuthorizationInput {
  authorizationId: string;
  amountCents: Cents;
  /** The CAPTURE operation's request id. */
  requestId: RequestId;
  invoiceId: AttemptId;
  /** Always true: Slip captures a hold once, in full. */
  finalCapture: true;
}

/**
 * A declined capture says nothing about the authorization: the caller asks `getAuthorization`
 * whether it is still alive (then voids it) or already gone.
 */
export type CaptureResult =
  | { kind: "captured"; captureId: string }
  | { kind: "pending"; captureId: string }
  | { kind: "declined"; reason: string }
  | { kind: "unknown"; reason: string };

export interface VoidAuthorizationInput {
  authorizationId: string;
  /** The VOID operation's request id. */
  requestId: RequestId;
}

export type VoidResult =
  | { kind: "voided" }
  /** Already final: VOIDED, EXPIRED or DENIED release the funds; CAPTURED means money moved. */
  | { kind: "not-voidable"; status: AuthorizationStatus; captureId: string | null }
  | { kind: "unknown"; reason: string };

export interface StartVaultSetupInput {
  mandateId: MandateId;
  requestId: RequestId;
  returnUrl: string;
  cancelUrl: string;
}

export type StartVaultSetupResult =
  | { kind: "started"; reference: string; approveUrl: string }
  | { kind: "failed"; reason: string };

export type CompleteVaultSetupResult =
  | { kind: "vaulted"; vaultId: string; customerId: string | null }
  /** Approved, but the vault id arrives later (webhook or a later poll). */
  | { kind: "pending"; customerId: string | null }
  | { kind: "not-approved" }
  | { kind: "failed"; reason: string };

export type DeleteVaultResult =
  | { kind: "deleted" }
  | { kind: "already-gone" }
  | { kind: "failed"; reason: string };

/** A webhook delivery exactly as received; verification needs the raw bytes and the headers. */
export interface WebhookRequest {
  headers: Readonly<Record<string, string | undefined>>;
  rawBody: string;
}

/**
 * A verified webhook, normalised. Payment events carry the attempt id from `custom_id` as a plain
 * string: it is outside data, and the application checks it before trusting it.
 */
export type GatewayEvent =
  | { kind: "capture-completed"; attemptId: string; orderId: string | null; captureId: string }
  | { kind: "capture-pending"; attemptId: string; orderId: string | null; captureId: string }
  | { kind: "capture-declined"; attemptId: string; captureId: string | null; reason: string }
  | {
      kind: "authorization-created";
      attemptId: string;
      orderId: string | null;
      authorizationId: string;
    }
  | { kind: "authorization-voided"; attemptId: string; authorizationId: string }
  | {
      kind: "vault-token-created";
      vaultId: string;
      customerId: string | null;
      setupReference: string | null;
    }
  | { kind: "vault-token-deleted"; vaultId: string }
  | { kind: "ignored"; eventType: string };

export interface PaymentGateway {
  createOrder(input: CreateOrderInput, signal: AbortSignal): Promise<OrderResult>;
  getOrder(orderId: string, signal: AbortSignal): Promise<OrderResult>;
  /** For an order whose request id PayPal no longer remembers: scans its transaction records. */
  findOrderByInvoice(input: FindOrderInput, signal: AbortSignal): Promise<OrderLookupResult>;
  captureAuthorization(
    input: CaptureAuthorizationInput,
    signal: AbortSignal,
  ): Promise<CaptureResult>;
  voidAuthorization(input: VoidAuthorizationInput, signal: AbortSignal): Promise<VoidResult>;
  getAuthorization(authorizationId: string, signal: AbortSignal): Promise<AuthorizationResult>;
  startVaultSetup(input: StartVaultSetupInput, signal: AbortSignal): Promise<StartVaultSetupResult>;
  completeVaultSetup(
    input: { reference: string; requestId: RequestId },
    signal: AbortSignal,
  ): Promise<CompleteVaultSetupResult>;
  deleteVaultToken(vaultId: string, signal: AbortSignal): Promise<DeleteVaultResult>;
  /** Checks a delivery's signature with the processor before anything acts on it. */
  verifyWebhook(request: WebhookRequest, signal: AbortSignal): Promise<boolean>;
  /** Normalises a verified, parsed payload. Pure: the resolver re-runs it on stored events. */
  interpretWebhook(payload: unknown): GatewayEvent;
}
