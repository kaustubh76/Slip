import type {
  AuthorizationResult,
  CaptureAuthorizationInput,
  CaptureResult,
  CreateOrderInput,
  OrderResult,
  PaymentGateway,
  VoidAuthorizationInput,
  VoidResult,
} from "@slip/domain";
import { type PayPalAnswer, type PayPalApi, said } from "./client.js";
import { authorizationResult, captureResult, orderResult, usd } from "./map.js";

/**
 * The money: creating an order against a vaulted PayPal wallet, and capturing or voiding the
 * authorization behind a hold.
 *
 * Slip charges a wallet its owner vaulted earlier, with nobody present — a merchant-initiated,
 * unscheduled charge. That is what `stored_credential` says, and PayPal needs it said: without it
 * the charge looks like one the payer is sitting in front of.
 *
 * Every call that moves money carries its operation's `PayPal-Request-Id`, which PayPal remembers
 * for 6 hours; repeating the call with that id returns the first result instead of charging again.
 * This adapter therefore never repeats anything itself — the resolver does, with the same id.
 *
 * The invoice id is the attempt id, sent as both `invoice_id` and `custom_id`: the first makes
 * PayPal refuse a second order for the same attempt, and the second is what webhooks echo back.
 */

export type OrderOperations = Pick<
  PaymentGateway,
  "createOrder" | "getOrder" | "captureAuthorization" | "voidAuthorization" | "getAuthorization"
>;

/** PayPal's limit for `purchase_units[].description`. */
const DESCRIPTION_LIMIT = 127;

/** Issues that mean the authorization can no longer be captured — the money is not coming. */
const CAPTURE_REFUSED = [
  "AUTHORIZATION_VOIDED",
  "AUTHORIZATION_EXPIRED",
  "AUTHORIZATION_DENIED",
  "PREVIOUSLY_VOIDED",
  "INSTRUMENT_DECLINED",
  "TRANSACTION_REFUSED",
  "PAYER_CANNOT_PAY",
  "PAYER_ACCOUNT_RESTRICTED",
  "PAYER_ACCOUNT_LOCKED_OR_CLOSED",
  "DECLINED_BY_RISK_FRAUD_FILTERS",
  "AUTHORIZATION_AMOUNT_EXCEEDED",
  "MAX_CAPTURE_AMOUNT_EXCEEDED",
];

/** Issues that mean the order was refused outright, with nothing held and nothing taken. */
const ORDER_DECLINED = [
  "INSTRUMENT_DECLINED",
  "PAYER_CANNOT_PAY",
  "PAYMENT_DENIED",
  "TRANSACTION_REFUSED",
  "DECLINED_BY_RISK_FRAUD_FILTERS",
  "PAYER_ACCOUNT_RESTRICTED",
  "PAYER_ACCOUNT_LOCKED_OR_CLOSED",
  "MISMATCHED_VAULT_ID_TO_PAYMENT_SOURCE",
  "VAULT_WITHOUT_PAYMENT",
];

/** Issues that mean the authorization is no longer in a state a void applies to. */
const VOID_REFUSED = [
  "AUTHORIZATION_ALREADY_CAPTURED",
  "PREVIOUSLY_CAPTURED",
  "PREVIOUSLY_VOIDED",
  "AUTHORIZATION_VOIDED",
  "AUTHORIZATION_EXPIRED",
  "AUTHORIZATION_DENIED",
  "CANNOT_BE_VOIDED",
];

export function createOrderOperations(api: PayPalApi): OrderOperations {
  const operations: OrderOperations = {
    async createOrder(input: CreateOrderInput, signal): Promise<OrderResult> {
      const description = input.description.trim().slice(0, DESCRIPTION_LIMIT);
      const answer = await api.call(
        {
          path: "/v2/checkout/orders",
          method: "POST",
          requestId: input.requestId,
          representation: true,
          body: {
            intent: input.intent,
            purchase_units: [
              {
                amount: { currency_code: "USD", value: usd(input.amountCents) },
                invoice_id: input.invoiceId,
                custom_id: input.invoiceId,
                ...(description === "" ? {} : { description }),
              },
            ],
            payment_source: {
              paypal: {
                vault_id: input.vaultId,
                stored_credential: {
                  // Slip charges while nobody is at PayPal, for a purchase of no fixed schedule.
                  payment_initiator: "MERCHANT",
                  usage: "SUBSEQUENT",
                  usage_pattern: "UNSCHEDULED_POSTPAID",
                },
              },
            },
          },
        },
        signal,
      );
      if (answer.outcome === "no-answer") {
        return { kind: "unknown", reason: answer.detail };
      }
      if (answer.outcome === "error") {
        // A second order for one attempt is never a failure: the first one is out there.
        if (said(answer, "DUPLICATE_INVOICE_ID", "INVALID_INVOICE_ID")) {
          return { kind: "duplicate-invoice", reason: answer.detail };
        }
        if (said(answer, "PAYER_ACTION_REQUIRED")) {
          return { kind: "payer-action-required", orderId: null, approveUrl: null };
        }
        if (said(answer, ...ORDER_DECLINED)) {
          return { kind: "declined", orderId: null, reason: answer.detail };
        }
        return { kind: "unknown", reason: answer.detail };
      }
      const result = orderResult(answer.body);
      return result ?? { kind: "unknown", reason: "PayPal's order could not be read" };
    },

    async getOrder(orderId, signal): Promise<OrderResult> {
      const answer = await api.call({ path: `/v2/checkout/orders/${path(orderId)}` }, signal);
      if (answer.outcome === "ok") {
        const result = orderResult(answer.body);
        return result ?? { kind: "unknown", reason: "PayPal's order could not be read" };
      }
      // Even "no such order" is unknown: this is a read, and a read cannot settle a payment.
      return { kind: "unknown", reason: detailOf(answer) };
    },

    async captureAuthorization(input: CaptureAuthorizationInput, signal): Promise<CaptureResult> {
      const answer = await api.call(
        {
          path: `/v2/payments/authorizations/${path(input.authorizationId)}/capture`,
          method: "POST",
          requestId: input.requestId,
          representation: true,
          body: {
            amount: { currency_code: "USD", value: usd(input.amountCents) },
            invoice_id: input.invoiceId,
            final_capture: input.finalCapture,
          },
        },
        signal,
      );
      if (answer.outcome === "ok") {
        const result = captureResult(answer.body);
        return result ?? { kind: "unknown", reason: "PayPal's capture could not be read" };
      }
      if (answer.outcome === "error" && said(answer, ...CAPTURE_REFUSED)) {
        // Declined says nothing about the authorization; the caller reads it before voiding.
        return { kind: "declined", reason: answer.detail };
      }
      // Already captured, or anything else: the caller reads the authorization to find the
      // capture, rather than this adapter guessing an id it was not given.
      return { kind: "unknown", reason: detailOf(answer) };
    },

    async voidAuthorization(input: VoidAuthorizationInput, signal): Promise<VoidResult> {
      const answer = await api.call(
        {
          path: `/v2/payments/authorizations/${path(input.authorizationId)}/void`,
          method: "POST",
          requestId: input.requestId,
          representation: true,
        },
        signal,
      );
      if (answer.outcome === "ok") {
        // 204, or 200 with the authorization. A replay of this request id lands here too.
        const read = authorizationResult(answer.body);
        if (read !== null && read.kind === "found" && read.status !== "VOIDED") {
          return { kind: "not-voidable", status: read.status, captureId: read.captureId };
        }
        return { kind: "voided" };
      }
      if (answer.outcome === "error" && said(answer, ...VOID_REFUSED)) {
        // Refused because the hold has already ended. Which ending it was decides what Slip does
        // next — captured is money gone, voided is money released — so ask, never assume.
        const read = await operations.getAuthorization(input.authorizationId, signal);
        return read.kind === "found"
          ? { kind: "not-voidable", status: read.status, captureId: read.captureId }
          : { kind: "unknown", reason: read.reason };
      }
      return { kind: "unknown", reason: detailOf(answer) };
    },

    async getAuthorization(authorizationId, signal): Promise<AuthorizationResult> {
      const answer = await api.call(
        { path: `/v2/payments/authorizations/${path(authorizationId)}` },
        signal,
      );
      if (answer.outcome !== "ok") {
        return { kind: "unknown", reason: detailOf(answer) };
      }
      const result = authorizationResult(answer.body);
      return result ?? { kind: "unknown", reason: "PayPal's authorization could not be read" };
    },
  };
  return operations;
}

const detailOf = (answer: PayPalAnswer): string =>
  answer.outcome === "ok" ? `PayPal answered ${answer.status}` : answer.detail;

/** An id from PayPal goes back into a path; encoding it keeps a stray character out of the url. */
const path = (id: string): string => encodeURIComponent(id);
