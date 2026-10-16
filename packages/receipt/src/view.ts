import {
  type AttemptId,
  type Cents,
  formatPct,
  formatUsd,
  type Hold,
  type Offer,
  type Outcome,
  type PaymentStatus,
  type Policy,
  type PolicyVersion,
  type Receipt,
  type RuleCode,
  type SnapshotId,
} from "@slip/domain";
import { utcTime } from "./format.js";
import { gapPercent } from "./percent.js";
import { type StateLine, stateLine } from "./state.js";

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
  /** This attempt's own payment; `NONE` when it has no PayPal order. */
  paymentStatus: PaymentStatus;
  /** True only when this attempt's own payment moved money (it is CAPTURED). */
  charged: boolean;
  /**
   * Where the money stands, in one line decided from the payment, the hold and any follow-up
   * together. `state.charged` is true when money moved for this purchase, including through the
   * owner-approval attempt that paid for a hold.
   */
  state: StateLine;
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

export interface RenderOptions {
  /** The policy at the version the attempt was checked under; adds the owner's own numbers. */
  policy?: Policy;
  /** For an approved hold with no reservation: the owner-approval attempt that paid for it. */
  child?: Receipt | null;
}

export function renderReceipt(receipt: Receipt, options: RenderOptions = {}): ReceiptView {
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
          percent: gapPercent(
            result.gapAbsCents,
            best.priceCents,
            decision.ruleCode === "R4_OVERPAID" && options.policy !== undefined
              ? { above: options.policy.maxOverpayPctHundredths }
              : {},
          ),
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
  const state = stateLine(receipt, { store: chosen?.domain ?? null, child: options.child ?? null });
  if (decision.outcome === "REJECTED") {
    // The verdict already says what happened to the money.
    lines.push("Payment rejected. Nothing was charged.");
  } else {
    lines.push(state.text);
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
    state,
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
