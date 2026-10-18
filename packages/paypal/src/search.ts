import type { Cents, FindOrderInput, OrderLookupResult, OrderResult } from "@slip/domain";
import { parseUsdStringToCents } from "@slip/domain";
import type { PayPalApi } from "./client.js";
import { text } from "./map.js";

/**
 * The last resort: finding an order Slip has no id for, in PayPal's transaction records. This is
 * what stops a timed-out order from being charged twice — the resolver asks here before it is
 * allowed to give a payment up.
 *
 * Three facts shape it, all of them PayPal's:
 *
 * 1. **Reporting lags**, up to about three hours, so the caller only comes here once a payment is
 *    older than that. A "no" from a fresh window would mean nothing.
 * 2. **The invoice id cannot be filtered on.** It is reported but not a query parameter, so this
 *    scans the window and matches `invoice_id` *and* the amount itself. No narrower filter is
 *    sent: one that quietly excluded the record would turn a real payment into "not found", which
 *    is the one answer that can lead to charging twice.
 * 3. **`balance_affecting_records_only` defaults to `Y`**, and an authorization affects no
 *    balance. Slip asks for `N`, or a hold Slip was looking for would be invisible here.
 *
 * A record only names its order; the order itself is then read, because reporting says what money
 * moved and the Orders API says what state the order is in.
 */

/** PayPal's own maximum: a window wider than this is refused. */
const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
/** 500 is PayPal's maximum page size; ten pages of a single account's traffic is generous. */
const PAGE_SIZE = 500;
const MAX_PAGES = 10;

interface TransactionInfo {
  transaction_id?: unknown;
  paypal_reference_id?: unknown;
  paypal_reference_id_type?: unknown;
  transaction_status?: unknown;
  transaction_amount?: { currency_code?: unknown; value?: unknown };
  invoice_id?: unknown;
  custom_field?: unknown;
}

export interface OrderLookup {
  findOrderByInvoice(input: FindOrderInput, signal: AbortSignal): Promise<OrderLookupResult>;
}

export function createOrderLookup(
  api: PayPalApi,
  readOrder: (orderId: string, signal: AbortSignal) => Promise<OrderResult>,
): OrderLookup {
  return {
    async findOrderByInvoice(input, signal): Promise<OrderLookupResult> {
      const to = input.to;
      // Never ask for more than PayPal allows: a refused window would read as "not found".
      const from = new Date(Math.max(input.from.getTime(), to.getTime() - MAX_WINDOW_MS));
      if (from.getTime() > to.getTime()) {
        return { kind: "unknown", reason: "the search window ends before it starts" };
      }

      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const answer = await api.call(
          {
            path: "/v1/reporting/transactions",
            // Dates in ISO 8601 rather than reporting's older format, so a window means one thing.
            headers: { "paypal-enforce-iso8601-format": "true" },
            query: {
              start_date: iso(from),
              end_date: iso(to),
              fields: "transaction_info",
              // An authorization moves no balance, and a hold is exactly what may be missing.
              balance_affecting_records_only: "N",
              page_size: String(PAGE_SIZE),
              page: String(page),
            },
          },
          signal,
        );
        if (answer.outcome !== "ok") {
          // Unknown, never "not found": Slip has not looked, so it may not conclude anything.
          return {
            kind: "unknown",
            reason: answer.outcome === "error" ? answer.detail : answer.detail,
          };
        }
        const body = answer.body as {
          transaction_details?: { transaction_info?: TransactionInfo }[];
          total_pages?: unknown;
        } | null;
        const details = Array.isArray(body?.transaction_details) ? body.transaction_details : [];
        const match = details
          .map((detail) => detail?.transaction_info)
          .find(
            (info): info is TransactionInfo =>
              info !== undefined && matches(info, input.invoiceId, input.amountCents),
          );
        if (match !== undefined) {
          return found(match, readOrder, signal);
        }
        const totalPages = typeof body?.total_pages === "number" ? body.total_pages : page;
        if (details.length === 0 || page >= totalPages) {
          return { kind: "not-found" };
        }
      }
      // More pages than Slip will read: saying "not found" here could cost a second charge.
      return { kind: "unknown", reason: `more than ${MAX_PAGES} pages of transactions to scan` };
    },
  };
}

/**
 * The record is Slip's attempt when the invoice id *and* the amount agree. The amount is compared
 * as an absolute value: a reversal of the same payment is reported as a negative of it, and both
 * mean the money moved.
 */
function matches(info: TransactionInfo, invoiceId: string, amount: Cents): boolean {
  if (text(info.invoice_id) !== invoiceId) {
    return false;
  }
  const money = info.transaction_amount;
  if (text(money?.currency_code) !== "USD") {
    return false;
  }
  const value = text(money?.value);
  if (value === null) {
    return false;
  }
  try {
    return parseUsdStringToCents(value.replace("-", "")) === amount;
  } catch {
    return false;
  }
}

/**
 * What the matched record means. A record names the order it belongs to (`ODR`), and the order is
 * then read: reporting tells Slip money moved, the Orders API tells it what the order *is*. Only
 * if that read fails does the record's own status stand in.
 */
async function found(
  info: TransactionInfo,
  readOrder: (orderId: string, signal: AbortSignal) => Promise<OrderResult>,
  signal: AbortSignal,
): Promise<OrderLookupResult> {
  const transactionId = text(info.transaction_id);
  const orderId =
    text(info.paypal_reference_id_type) === "ODR" ? text(info.paypal_reference_id) : null;
  if (orderId === null) {
    // Slip knows a payment happened but cannot name its order. Not a guess, and not a "no":
    // the payment stays open for a person to settle.
    return {
      kind: "unknown",
      reason: `a transaction (${transactionId ?? "unnamed"}) matched this attempt but named no order`,
    };
  }
  const order = await readOrder(orderId, signal);
  if (order.kind !== "unknown") {
    return { kind: "found", order };
  }
  // The order could not be read; the record's own status is what is left to go on.
  switch (text(info.transaction_status)) {
    case "S":
    case "V":
      return transactionId === null
        ? { kind: "unknown", reason: order.reason }
        : { kind: "found", order: { kind: "captured", orderId, captureId: transactionId } };
    case "P":
      return {
        kind: "found",
        order: { kind: "pending", orderId, captureId: transactionId, authorizationId: null },
      };
    case "D":
      return { kind: "found", order: { kind: "declined", orderId, reason: "TRANSACTION_DENIED" } };
    default:
      return { kind: "unknown", reason: order.reason };
  }
}

/** PayPal wants seconds, and no fraction of one. */
function iso(when: Date): string {
  return `${when.toISOString().slice(0, 19)}Z`;
}
