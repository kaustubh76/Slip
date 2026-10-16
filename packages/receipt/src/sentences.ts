import {
  type Attempt,
  formatPct,
  formatUsd,
  type Offer,
  type OfferSnapshot,
  type Policy,
  type RuleCode,
  type SelectedOption,
} from "@slip/domain";
import { shortNo, utcTime } from "./format.js";
import type { OfferSummary } from "./schema.js";

/**
 * Every sentence the owner reads, filled in from the stored record. Rules are code and so are
 * these words: no language model writes a receipt. Plain words only — dollars, percent, "listed
 * item price"; never trading jargon or a savings claim.
 */

const REJECTED = "Payment rejected. Nothing was charged.";
const HELD = "Held for you.";

/** What the agent picked, against the lowest listed price, in up to four sentences. */
export function openingLines(input: {
  chosen: OfferSummary | null;
  best: OfferSummary | null;
  gap: { amount: string; percent: string } | null;
  ruleCode: RuleCode;
  conflict: boolean;
}): string[] {
  const { chosen, best, gap } = input;
  const lines: string[] = [];
  if (chosen !== null) {
    lines.push(`Your agent tried to pay ${chosen.price} at ${chosen.store}.`);
  }
  if (best !== null) {
    if (chosen === null) {
      lines.push(`The lowest listed price for this item was ${best.price} at ${best.store}.`);
    } else if (gap === null) {
      lines.push("That was the lowest listed item price.");
    } else {
      lines.push(`The same item was listed at ${best.price} at ${best.store}.`);
      lines.push(
        input.ruleCode === "R4_OVERPAID"
          ? `Overpaid by ${gap.amount} (${gap.percent}).`
          : `That is ${gap.amount} (${gap.percent}) more than the lowest listed price.`,
      );
    }
  }
  if (input.conflict && chosen?.commission && best?.commission) {
    lines.push(
      `${chosen.store} pays your agent's platform up to ${chosen.commission} commission; ${best.store} pays up to ${best.commission}.`,
    );
  }
  return lines;
}

/** The decision in one sentence (or two), by the rule that decided it. */
export function verdict(input: {
  attempt: Attempt;
  chosen: OfferSummary | null;
  chosenOffer: Offer | null;
  policy: Policy | undefined;
  snapshot: OfferSnapshot | null;
}): string {
  const { attempt, chosen, policy } = input;
  switch (attempt.decision.ruleCode) {
    case "R7_WITHIN_LIMITS":
      return "Within your limits.";
    case "OWNER_APPROVED":
      return attempt.parentAttemptId === null
        ? "You approved this purchase; Slip checked the price again first."
        : `You approved hold no. ${shortNo(attempt.parentAttemptId)} at ${utcTime(attempt.createdAt)}; Slip checked the price again first.`;
    case "R4_OVERPAID":
      return REJECTED;
    case "R3_STEERED":
      return `The listing text read like instructions to the agent. ${REJECTED}`;
    case "VARIANT_MISMATCH": {
      const requested = variant(attempt.selectedOptions);
      const listed = input.snapshot === null ? null : variant(input.snapshot.selectedOptions);
      return listed === null
        ? `Your agent asked for ${requested}, which is not the variant Channel3 listed. ${REJECTED}`
        : `Your agent asked for ${requested} but this listing is ${listed}. ${REJECTED}`;
    }
    case "OFFER_NOT_FOUND":
      return `That offer was not in Channel3's listing for this item. ${REJECTED}`;
    case "CHOSEN_UNAVAILABLE":
      return input.chosenOffer?.availability === "OutOfStock"
        ? `That offer was out of stock. ${REJECTED}`
        : `That offer was listed as used. ${REJECTED}`;
    case "R1_STALE_SNAPSHOT":
      return `No fresh listed item prices were available. ${HELD}`;
    case "CHOSEN_UNVERIFIED":
      return `${unverified(input.chosenOffer)} ${HELD}`;
    case "R2_TOO_FEW_OFFERS":
      return `No other comparable offer was listed, so the price could not be checked. ${HELD}`;
    case "R4A_NO_CLASSIFIER_ANSWER":
      return `The steering check gave no answer in time. ${HELD}`;
    case "R5_COMMISSION_CONFLICT":
      return `The pricier store pays your agent's platform more commission. ${HELD}`;
    case "R6_ABOVE_ORDER_CAP":
      return policy === undefined || chosen === null
        ? `This order is above your order cap. ${HELD}`
        : `${chosen.price} is above your ${formatUsd(policy.orderCapCents)} order cap. ${HELD}`;
  }
}

function variant(options: readonly SelectedOption[] | null): string {
  return options === null || options.length === 0
    ? "no particular variant"
    : options.map((o) => `${o.name}: ${o.label}`).join(", ");
}

function unverified(offer: Offer | null): string {
  if (offer !== null && offer.currency !== "USD") {
    return `The listing is priced in ${offer.currency}, not US dollars.`;
  }
  if (offer === null || offer.priceCents === null) {
    return "The listing did not state the price clearly.";
  }
  if (offer.condition === null) {
    return "The listing did not state the condition clearly.";
  }
  return "The listing did not state its price, condition or currency clearly.";
}

/** Where the prices came from, and what they leave out. */
export function footer(pricesAt: Date | null, decidedAt: Date): string {
  return pricesAt === null
    ? `No listed item prices from Channel3 at ${utcTime(decidedAt)}.`
    : `Listed item prices from Channel3 at ${utcTime(pricesAt)}. Shipping and tax are not included.`;
}

/** Why one rule tripped, for the list of rules behind the receipt; adds the owner's own numbers. */
export function ruleSentence(code: RuleCode, policy: Policy | undefined): string {
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
