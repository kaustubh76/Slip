import {
  type AttemptId,
  type Cents,
  formatPct,
  formatUsd,
  type Hold,
  type Offer,
  type Outcome,
  type Payment,
  type PaymentStatus,
  type Policy,
  type PolicyVersion,
  type Receipt,
  type RuleCode,
  type SnapshotId,
} from "@slip/domain";

/**
 * The receipt as people read it — the owner in five seconds, the agent as structured fields.
 * Every number is filled in here from the stored record, never by a language model, and the words
 * stay plain: dollars and percent, "listed item price", no trading jargon.
 */

export interface OfferSummary {
  domain: string;
  url: string;
  priceCents: Cents;
  price: string;
  /** "8%" when the store's commission is known and above zero. */
  commission: string | null;
}

export interface ReceiptView {
  receiptId: AttemptId;
  outcome: Outcome;
  ruleCode: RuleCode;
  /** One plain sentence per rule that tripped, deciding rule first. */
  reasons: string[];
  /** The whole receipt, in reading order. */
  lines: string[];
  chosen: OfferSummary | null;
  best: OfferSummary | null;
  gap: { cents: Cents; amount: string; percent: string } | null;
  paymentStatus: PaymentStatus;
  /** True only when money actually moved (the payment is CAPTURED). */
  charged: boolean;
  paypal: {
    orderId: string | null;
    authorizationId: string | null;
    captureId: string | null;
  } | null;
  hold: { status: Hold["status"]; expiresAt: Date } | null;
  policyVersion: PolicyVersion;
  snapshotId: SnapshotId | null;
  pricesAt: Date | null;
  createdAt: Date;
}

/**
 * Percent with one decimal, rounded half-up from exact cents (integer arithmetic, so 12.25 % shows
 * as "12.3%"); whole numbers drop the decimal ("15%").
 */
export function percentOf(part: Cents, base: Cents): string {
  if (base <= 0) {
    throw new Error("base must be positive");
  }
  const tenths = Math.floor((2 * part * 1_000 + base) / (2 * base));
  const whole = Math.floor(tenths / 10);
  const rest = tenths % 10;
  return rest === 0 ? `${whole}%` : `${whole}.${rest}%`;
}

function summary(offer: Offer | null): OfferSummary | null {
  if (offer === null || offer.priceCents === null) {
    return null;
  }
  return {
    domain: offer.domain,
    url: offer.url,
    priceCents: offer.priceCents,
    price: formatUsd(offer.priceCents),
    commission:
      offer.commissionBps !== null && offer.commissionBps > 0
        ? formatPct(offer.commissionBps)
        : null,
  };
}

function utcTime(date: Date): string {
  return `${date.toISOString().slice(11, 16)} UTC`;
}

function utcDateTime(date: Date): string {
  return `${date.toISOString().slice(0, 10)} ${utcTime(date)}`;
}

/** Why each rule tripped, in words; `policy` (when known) adds the owner's own numbers. */
function reasonFor(code: RuleCode, policy: Policy | undefined): string {
  switch (code) {
    case "R1_STALE_SNAPSHOT":
      return "Slip could not get current prices for this item, so it held the purchase for you.";
    case "VARIANT_MISMATCH":
      return "The agent asked for a different variant from the listing it chose.";
    case "OFFER_NOT_FOUND":
      return "The listing the agent chose is not among the offers Slip found for this item.";
    case "CHOSEN_UNAVAILABLE":
      return "The listing the agent chose is out of stock or not new.";
    case "CHOSEN_UNVERIFIED":
      return "Slip could not confirm the chosen listing's condition, currency or price.";
    case "R2_TOO_FEW_OFFERS":
      return "Fewer than two comparable listings were found, so the price could not be compared.";
    case "R3_STEERED":
      return "The listing contained text aimed at shopping agents, and a cheaper listing existed.";
    case "R4_OVERPAID":
      return policy === undefined
        ? "The price was above the lowest listed price by more than your limits allow."
        : `The price was more than ${formatPct(policy.maxOverpayPctHundredths)} and ${formatUsd(policy.maxOverpayAbsCents)} above the lowest listed price.`;
    case "R4A_NO_CLASSIFIER_ANSWER":
      return "Slip's check for text aimed at agents did not answer in time, so it held the purchase for you.";
    case "R5_COMMISSION_CONFLICT":
      return "The pricier store pays your agent's platform more commission than the cheaper one.";
    case "R6_ABOVE_ORDER_CAP":
      return policy === undefined
        ? "The order is above your order limit."
        : `The order is above your ${formatUsd(policy.orderCapCents)} order limit.`;
    case "R7_WITHIN_LIMITS":
      return "The price is within your limits.";
    case "OWNER_APPROVED":
      return "You approved this purchase.";
  }
}

function paymentLine(
  payment: Payment | null,
  chosen: OfferSummary | null,
  outcome: Outcome,
): string | null {
  if (payment === null) {
    return outcome === "PAID" ? "Payment is being prepared." : null;
  }
  const where = chosen === null ? "" : ` at ${chosen.domain}`;
  const amount = formatUsd(payment.amountCents);
  switch (payment.status) {
    case "CAPTURED":
      return `Paid ${amount}${where}.`;
    case "INITIATED":
    case "UNKNOWN":
    case "PENDING":
      return payment.intent === "CAPTURE"
        ? "The payment is being confirmed with PayPal. Nothing is final yet."
        : "The reservation is being confirmed with PayPal.";
    case "AUTHORIZED":
      return `${amount} is reserved on your PayPal account until you decide.`;
    case "CAPTURING":
      return `Collecting the ${amount} you approved.`;
    case "VOIDING":
    case "VOIDED":
      return "The reservation was released. Nothing was charged.";
    case "FAILED":
      return `PayPal did not complete the payment (${payment.failureReason ?? "no reason given"}). Nothing was charged.`;
    case "NONE":
      return null;
  }
}

function holdLine(hold: Hold | null): string | null {
  if (hold === null) {
    return null;
  }
  switch (hold.status) {
    case "PENDING":
      return `Held for your approval until ${utcDateTime(hold.expiresAt)}.`;
    case "APPROVED":
      return "You approved this purchase.";
    case "DECLINED":
      return "You declined this purchase.";
    case "EXPIRED":
      return "No decision was made in time, so the hold was released.";
  }
}

export function renderReceipt(receipt: Receipt, options: { policy?: Policy } = {}): ReceiptView {
  const { attempt, payment, hold } = receipt;
  const { decision } = attempt;
  const result = decision.checkResult;
  const chosen = summary(result.chosen);
  const best = summary(result.best);
  const gap =
    result.gapAbsCents !== null && best !== null && result.gapAbsCents > 0
      ? {
          cents: result.gapAbsCents,
          amount: formatUsd(result.gapAbsCents),
          percent: percentOf(result.gapAbsCents, best.priceCents),
        }
      : null;
  const reasons = result.ruleCodes.map((code) => reasonFor(code, options.policy));

  const lines: string[] = [];
  if (chosen !== null) {
    lines.push(`Your agent tried to pay ${chosen.price} at ${chosen.domain}.`);
  }
  if (best !== null && chosen !== null) {
    if (gap === null) {
      lines.push("That is the lowest listed price for this item.");
    } else {
      lines.push(`The same item was listed at ${best.price} at ${best.domain}.`);
      lines.push(
        decision.ruleCode === "R4_OVERPAID"
          ? `Overpaid by ${gap.amount} (${gap.percent}).`
          : `That is ${gap.amount} (${gap.percent}) above the lowest listed price.`,
      );
    }
  }
  if (result.conflict && chosen?.commission && best?.commission) {
    lines.push(
      `${chosen.domain} pays your agent's platform up to ${chosen.commission} commission; ${best.domain} pays up to ${best.commission}.`,
    );
  }
  lines.push(...reasons);
  if (decision.outcome === "REJECTED") {
    lines.push("Payment rejected. Nothing was charged.");
  }
  const holdText = holdLine(hold);
  if (holdText !== null && !lines.includes(holdText)) {
    lines.push(holdText);
  }
  const paymentText = paymentLine(payment, chosen, decision.outcome);
  if (paymentText !== null) {
    lines.push(paymentText);
  }
  if (decision.outcome === "HELD" && payment === null && hold?.status === "PENDING") {
    lines.push("Nothing has been charged or reserved.");
  }
  lines.push(
    result.snapshotFetchedAt === null
      ? "Slip had no current listed prices for this item."
      : `Listed item prices from Channel3 at ${utcTime(result.snapshotFetchedAt)}. Shipping and tax are not included.`,
  );

  return {
    receiptId: attempt.id,
    outcome: decision.outcome,
    ruleCode: decision.ruleCode,
    reasons,
    lines,
    chosen,
    best,
    gap,
    paymentStatus: payment?.status ?? "NONE",
    charged: payment?.status === "CAPTURED",
    paypal:
      payment === null
        ? null
        : {
            orderId: payment.paypalOrderId,
            authorizationId: payment.authorizationId,
            captureId: payment.captureId,
          },
    hold: hold === null ? null : { status: hold.status, expiresAt: hold.expiresAt },
    policyVersion: result.policyVersion,
    snapshotId: result.snapshotId,
    pricesAt: result.snapshotFetchedAt,
    createdAt: attempt.createdAt,
  };
}
