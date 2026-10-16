import {
  type Cents,
  formatUsd,
  type Hold,
  type Payment,
  type PaymentStatus,
  type Receipt,
  SYSTEM_DECIDER,
} from "@slip/domain";
import { shortNo, utcDayTime, utcTime } from "./format.js";

/**
 * One line about the money: where this attempt's payment, its hold and any follow-up attempt
 * stand now. It is one line, decided from all of them together, so it can never say "you
 * declined" next to "the money is reserved until you decide".
 */

/** Marks typed in front of the line: open, done, released, refused, unknown. */
export type StateGlyph = "[ ]" | "[x]" | "[-]" | "[!]" | "[?]";

export interface StateLine {
  glyph: StateGlyph | null;
  /** The payment status the line reports; `NONE` when there is no PayPal order. */
  word: PaymentStatus;
  text: string;
  /** PayPal still has work to do; the line will change. */
  inFlight: boolean;
  /** Money moved: this payment, or the follow-up that paid for this hold, was captured. */
  charged: boolean;
}

export interface StateContext {
  /** How the chosen store is named in sentences, or null when the chosen offer is unknown. */
  store: string | null;
  /** The OWNER_APPROVAL attempt that paid for this hold, if one was made. */
  child: Receipt | null;
}

const GLYPH: Readonly<Record<PaymentStatus, StateGlyph | null>> = {
  NONE: null,
  INITIATED: "[ ]",
  UNKNOWN: "[?]",
  PENDING: "[ ]",
  AUTHORIZED: "[ ]",
  CAPTURING: "[ ]",
  VOIDING: "[ ]",
  CAPTURED: "[x]",
  VOIDED: "[-]",
  FAILED: "[!]",
};

const MOVING: ReadonlySet<PaymentStatus> = new Set([
  "INITIATED",
  "UNKNOWN",
  "PENDING",
  "CAPTURING",
  "VOIDING",
]);

function line(word: PaymentStatus, text: string, inFlight: boolean = MOVING.has(word)): StateLine {
  return { glyph: GLYPH[word], word, text, inFlight, charged: word === "CAPTURED" };
}

const at = (store: string | null) => (store === null ? "" : ` at ${store}`);
const why = (payment: Payment) => payment.failureReason ?? "no reason given";
const captureTried = (payment: Payment) => payment.operations.some((op) => op.kind === "CAPTURE");

/** A status that cannot occur with this hold and intent still gets an honest line. */
function plain(payment: Payment, amount: string): StateLine {
  if (payment.status === "CAPTURED") {
    return line("CAPTURED", `Paid ${amount}.`);
  }
  return line(payment.status, `PayPal reports this payment as ${payment.status}.`);
}

/** The line for an attempt, or null for none at all (never: every outcome has one). */
export function stateLine(receipt: Receipt, ctx: StateContext): StateLine {
  const { attempt, payment, hold } = receipt;
  if (attempt.decision.outcome === "REJECTED") {
    return line("NONE", "No PayPal order was made. Nothing was charged.");
  }
  const amountCents: Cents | null =
    payment?.amountCents ?? attempt.decision.checkResult.chosen?.priceCents ?? null;
  const amount = amountCents === null ? "the money" : formatUsd(amountCents);
  if (hold === null) {
    return oneStep(payment, amount, ctx.store);
  }
  switch (hold.status) {
    case "PENDING":
      return awaiting(payment, amount, hold);
    case "APPROVED":
      return approved(payment, amount, hold, ctx);
    case "DECLINED":
    case "EXPIRED":
      return closed(payment, hold);
  }
}

/** A PAID attempt: one-step capture. */
function oneStep(payment: Payment | null, amount: string, store: string | null): StateLine {
  if (payment === null) {
    return line("NONE", "The payment is being prepared.", true);
  }
  switch (payment.status) {
    case "INITIATED":
      return line("INITIATED", "Sending the order to PayPal. Nothing is final yet.");
    case "UNKNOWN":
      return line(
        "UNKNOWN",
        "PayPal did not answer in time. Slip is checking with the same request, so there will never be a second order.",
      );
    case "PENDING":
      return line("PENDING", "PayPal is still settling this payment.");
    case "CAPTURED":
      return line("CAPTURED", `Paid ${amount}${at(store)}.`);
    case "FAILED":
      return line("FAILED", `PayPal declined the payment (${why(payment)}). Nothing was charged.`);
    default:
      return plain(payment, amount);
  }
}

const RECHECK = "Approving checks again at current listed prices and pays in one step.";

/** A hold waiting for the owner. */
function awaiting(payment: Payment | null, amount: string, hold: Hold): StateLine {
  if (payment === null) {
    return line("NONE", `Nothing is reserved. ${RECHECK}`);
  }
  switch (payment.status) {
    case "INITIATED":
    case "PENDING":
      return line(payment.status, `Asking PayPal to reserve ${amount}. Nothing is charged.`);
    case "UNKNOWN":
      return line(
        "UNKNOWN",
        `PayPal did not answer in time; Slip is checking whether ${amount} was reserved. Nothing is charged.`,
      );
    case "AUTHORIZED":
      return line(
        "AUTHORIZED",
        `${amount} is reserved, not charged, until you decide (by ${utcDayTime(hold.expiresAt)}).`,
      );
    case "FAILED":
      return captureTried(payment)
        ? plain(payment, amount)
        : line(
            "FAILED",
            `PayPal could not reserve the money (${why(payment)}). Nothing is charged. ${RECHECK}`,
          );
    case "VOIDED":
      return captureTried(payment)
        ? plain(payment, amount)
        : line("VOIDED", `PayPal released the reservation. Nothing is charged. ${RECHECK}`);
    default:
      return plain(payment, amount);
  }
}

/** The owner approved: the reservation is collected, or a follow-up attempt pays in one step. */
function approved(
  payment: Payment | null,
  amount: string,
  hold: Hold,
  ctx: StateContext,
): StateLine {
  const by = `You approved at ${utcTime(hold.decidedAt ?? hold.createdAt)}`;
  const followUp =
    payment === null ||
    ((payment.status === "FAILED" || payment.status === "VOIDED") && !captureTried(payment));
  if (!followUp) {
    switch (payment.status) {
      case "CAPTURING":
        return line("CAPTURING", `${by}. Collecting ${amount}.`);
      case "CAPTURED":
        return line("CAPTURED", `${by}. Paid ${amount}${at(ctx.store)}.`);
      case "FAILED":
        return line(
          "FAILED",
          `${by}, but PayPal declined collecting it (${why(payment)}). Nothing was charged.`,
        );
      case "VOIDING":
        return line(
          "VOIDING",
          `${by}, but PayPal declined collecting it. Releasing the reservation; nothing was charged.`,
        );
      case "VOIDED":
        return line(
          "VOIDED",
          `${by}, but PayPal declined collecting it. Reservation released; nothing was charged.`,
        );
      default:
        return plain(payment, amount);
    }
  }
  const paid = ctx.child?.payment ?? null;
  if (ctx.child === null || paid === null) {
    return line("NONE", `${by}. Checking again at current listed prices.`, true);
  }
  const no = `follow-up receipt no. ${shortNo(ctx.child.attempt.id)}`;
  const charge = formatUsd(paid.amountCents);
  switch (paid.status) {
    case "INITIATED":
    case "UNKNOWN":
    case "PENDING":
      return line(paid.status, `${by}. Paying ${charge} in one step (${no}).`);
    case "CAPTURED":
      return line("CAPTURED", `${by}. Paid ${charge}${at(ctx.store)} in one step (${no}).`);
    case "FAILED":
      return line(
        "FAILED",
        `${by}, but PayPal declined the payment (${why(paid)}). Nothing was charged.`,
      );
    default:
      return plain(paid, charge);
  }
}

/** Declined by the owner, released by a revoke, or expired: the reservation is let go. */
function closed(payment: Payment | null, hold: Hold): StateLine {
  const when = utcTime(hold.decidedAt ?? hold.expiresAt);
  const who =
    hold.status === "EXPIRED"
      ? `No decision within 48 hours; the hold expired at ${when}`
      : hold.decidedBy === SYSTEM_DECIDER
        ? `Released when the mandate was revoked, at ${when}`
        : `You declined at ${when}`;
  if (payment === null) {
    return line("NONE", `${who}. Nothing was charged.`);
  }
  switch (payment.status) {
    case "INITIATED":
    case "UNKNOWN":
    case "PENDING":
      return line(
        payment.status,
        `${who}. Slip releases the reservation as soon as PayPal confirms it; nothing was charged.`,
      );
    case "AUTHORIZED":
      return line("AUTHORIZED", `${who}. Releasing the reservation; nothing was charged.`, true);
    case "VOIDING":
      return line("VOIDING", `${who}. Releasing the reservation; nothing was charged.`);
    case "VOIDED":
      return line("VOIDED", `${who}. Reservation released; nothing was charged.`);
    case "FAILED":
      return line("FAILED", `${who}. Nothing was charged.`);
    default:
      return plain(payment, formatUsd(payment.amountCents));
  }
}
