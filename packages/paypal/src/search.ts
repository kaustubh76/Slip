import type {
  Cents,
  FindOrderInput,
  OrderLookupResult,
  OrderResult,
  SettlementRecord,
  SettlementsResult,
} from "@slip/domain";
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
  listSettlements(
    window: { from: Date; to: Date },
    signal: AbortSignal,
  ): Promise<SettlementsResult>;
}

/** One page of the window, or the reason Slip has not seen it. Never a short page standing in. */
type Page =
  | { kind: "page"; records: TransactionInfo[]; last: boolean }
  | { kind: "unknown"; reason: string };

/**
 * The window scan both callers share: PayPal's reporting cannot be filtered by invoice id, so
 * whoever wants one record and whoever wants all of them read the same pages.
 */
async function scan(
  api: PayPalApi,
  window: { from: Date; to: Date },
  page: number,
  signal: AbortSignal,
): Promise<Page> {
  const answer = await api.call(
    {
      path: "/v1/reporting/transactions",
      // Dates in ISO 8601 rather than reporting's older format, so a window means one thing.
      headers: { "paypal-enforce-iso8601-format": "true" },
      query: {
        start_date: iso(window.from),
        end_date: iso(window.to),
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
    return { kind: "unknown", reason: answer.detail };
  }
  const body = answer.body as {
    transaction_details?: { transaction_info?: TransactionInfo }[];
    total_pages?: unknown;
  } | null;
  const details = Array.isArray(body?.transaction_details) ? body.transaction_details : [];
  const records = details
    .map((detail) => detail?.transaction_info)
    .filter((info): info is TransactionInfo => info !== undefined);
  const totalPages = typeof body?.total_pages === "number" ? body.total_pages : page;
  return { kind: "page", records, last: details.length === 0 || page >= totalPages };
}

/** The widest window PayPal will answer, ending where the caller asked. */
function allowed(window: { from: Date; to: Date }): { from: Date; to: Date } {
  return {
    from: new Date(Math.max(window.from.getTime(), window.to.getTime() - MAX_WINDOW_MS)),
    to: window.to,
  };
}

/**
 * What a record says became of the money. The per-order lookup deliberately treats a reversal as
 * proof the money moved; a reconcile has to keep them apart, or a refund is invisible to it.
 */
function settlement(info: TransactionInfo): SettlementRecord | null {
  const invoiceId = text(info.invoice_id) ?? text(info.custom_field);
  const money = info.transaction_amount;
  const value = text(money?.value);
  if (invoiceId === null || value === null || text(money?.currency_code) !== "USD") {
    return null;
  }
  let amountCents: number;
  try {
    amountCents = parseUsdStringToCents(value.replace("-", ""));
  } catch {
    return null;
  }
  const status = text(info.transaction_status);
  const kind =
    status === "S"
      ? "settled"
      : status === "P"
        ? "pending"
        : status === "V"
          ? "reversed"
          : status === "D"
            ? "denied"
            : "other";
  return {
    invoiceId,
    amountCents: value.trimStart().startsWith("-") ? -amountCents : amountCents,
    kind,
    transactionId: text(info.transaction_id),
  };
}

export function createOrderLookup(
  api: PayPalApi,
  readOrder: (orderId: string, signal: AbortSignal) => Promise<OrderResult>,
): OrderLookup {
  return {
    async findOrderByInvoice(input, signal): Promise<OrderLookupResult> {
      // Never ask for more than PayPal allows: a refused window would read as "not found".
      const window = allowed(input);
      if (window.from.getTime() > window.to.getTime()) {
        return { kind: "unknown", reason: "the search window ends before it starts" };
      }
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const answered = await scan(api, window, page, signal);
        if (answered.kind === "unknown") {
          return answered;
        }
        const match = answered.records.find((info) =>
          matches(info, input.invoiceId, input.amountCents),
        );
        if (match !== undefined) {
          return found(match, readOrder, signal);
        }
        if (answered.last) {
          return { kind: "not-found" };
        }
      }
      // More pages than Slip will read: saying "not found" here could cost a second charge.
      return { kind: "unknown", reason: `more than ${MAX_PAGES} pages of transactions to scan` };
    },

    async listSettlements(window, signal): Promise<SettlementsResult> {
      const asked = allowed(window);
      if (asked.from.getTime() > asked.to.getTime()) {
        return { kind: "unknown", reason: "the search window ends before it starts" };
      }
      const records: SettlementRecord[] = [];
      for (let page = 1; page <= MAX_PAGES; page += 1) {
        const answered = await scan(api, asked, page, signal);
        if (answered.kind === "unknown") {
          return answered;
        }
        for (const info of answered.records) {
          const record = settlement(info);
          if (record !== null) {
            records.push(record);
          }
        }
        if (answered.last) {
          return { kind: "listed", records };
        }
      }
      // A window Slip could not read to the end is not a window Slip may draw conclusions from:
      // the records it did not reach are exactly the ones it would report as missing.
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
