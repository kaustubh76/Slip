import type { Refusal, ReplayReason, ReportView } from "@slip/app";
import {
  type Cents,
  formatUsd,
  HOLD_STATUSES,
  OutcomeSchema,
  PAYMENT_STATUSES,
  RuleCodeSchema,
} from "@slip/domain";
import { type OfferSummary, percentFromHundredths, type ReceiptView } from "@slip/receipt";
import { z } from "zod";
import { nextStep } from "./next-step.js";

/**
 * What Slip's tools hand an agent: snake_case on the wire, as SPEC §8 writes it, and plain JSON.
 * The receipt lines are the owner's receipt word for word (D39), so an agent can explain itself in
 * the words its owner reads; `next_step` adds what to do about it.
 */

export const REPLAY_REASONS = [
  "ALREADY_PAID",
  "HOLD_OPEN",
  "RECENTLY_REJECTED",
] as const satisfies readonly ReplayReason[];

export const ToolOfferSchema = z.object({
  store: z.string().describe('The store as receipts name it, e.g. "Store B".'),
  url: z.string().describe("The offer's URL: pass it as chosen_offer_url to buy this offer."),
  price: z.string().describe('The listed item price, e.g. "$47.99". Shipping and tax excluded.'),
  price_cents: z.number().int(),
  commission: z
    .string()
    .nullable()
    .describe('What the store pays the agent\'s platform, e.g. "8%", when known.'),
});
export type ToolOffer = z.infer<typeof ToolOfferSchema>;

export const ToolReceiptSchema = z.object({
  receipt_id: z.string(),
  receipt_url: z.string().describe("Where the owner reads this receipt."),
  outcome: OutcomeSchema.describe("PAID, REJECTED or HELD for the owner."),
  rule: RuleCodeSchema.describe("The rule that decided it."),
  replayed: z
    .boolean()
    .describe("True when this repeats a purchase Slip had already decided: nothing new happened."),
  replay_reason: z.enum(REPLAY_REASONS).nullable(),
  charged: z.boolean().describe("True only when money moved for this purchase."),
  payment_status: z.enum(PAYMENT_STATUSES),
  in_flight: z.boolean().describe("True while PayPal is still working on the payment."),
  paypal_order_id: z.string().nullable(),
  chosen_offer: ToolOfferSchema.nullable(),
  best_offer: ToolOfferSchema.nullable().describe("The lowest listed comparable offer."),
  gap_abs: z
    .string()
    .nullable()
    .describe('How much more the chosen offer cost than the lowest, e.g. "$11.00".'),
  gap_pct: z.string().nullable().describe('The same gap in percent, e.g. "23%".'),
  reasons: z.array(z.string()).describe("One sentence per rule that tripped, deciding rule first."),
  receipt: z.array(z.string()).describe("The receipt the owner reads, line by line."),
  hold: z
    .object({ status: z.enum(HOLD_STATUSES), expires_at: z.string() })
    .nullable()
    .describe("For a held purchase: the owner's decision so far, and when the hold runs out."),
  follow_up_receipt_id: z
    .string()
    .nullable()
    .describe("When the owner approved a hold that had nothing reserved: the purchase that paid."),
  simulated: z
    .boolean()
    .describe(
      "True when the stores and prices came from a stand-in catalogue rather than Channel3. It" +
        " says nothing about the payment: see `payment_simulated`.",
    ),
  payment_simulated: z
    .boolean()
    .describe(
      "True when no money moved through PayPal at all, because the gateway was a stand-in." +
        " A real sandbox payment is false here: no real money moves there either, but PayPal did.",
    ),
  next_step: z.string().describe("What to do next."),
});
export type ToolReceipt = z.infer<typeof ToolReceiptSchema>;

export const ToolReportSchema = z.object({
  attempted: z.number().int(),
  paid: z.number().int(),
  rejected: z.number().int(),
  held: z.number().int(),
  captured: z.number().int().describe("Payments that completed."),
  not_cheapest: z.number().int().describe("Purchases whose offer was not the cheapest comparable."),
  typical_overpay_pct: z.string().nullable(),
  worst_overpay_pct: z.string().nullable(),
  worst_overpay_abs: z.string().nullable(),
  steered: z.number().int().describe("Listings that carried text written to instruct AI agents."),
  conflicts: z.number().int().describe("Pricier picks whose store paid more commission."),
  report: z.array(z.string()).describe("The report card in plain words."),
});
export type ToolReport = z.infer<typeof ToolReportSchema>;

function toolOffer(offer: OfferSummary | null): ToolOffer | null {
  return offer === null
    ? null
    : {
        store: offer.store,
        url: offer.url,
        price: offer.price,
        price_cents: offer.priceCents,
        commission: offer.commission,
      };
}

export function toolReceipt(
  view: ReceiptView,
  options: {
    replay: ReplayReason | null;
    followUpId: string | null;
    receiptUrl: string;
    /** From `config.paymentSource`: whether PayPal was a stand-in. */
    paymentSimulated: boolean;
  },
): ToolReceipt {
  return {
    receipt_id: view.receiptId,
    receipt_url: options.receiptUrl,
    outcome: view.outcome,
    rule: view.ruleCode,
    replayed: options.replay !== null,
    replay_reason: options.replay,
    charged: view.state.charged,
    payment_status: view.paymentStatus,
    in_flight: view.state.inFlight,
    paypal_order_id: view.paypal?.orderId ?? null,
    chosen_offer: toolOffer(view.chosen),
    best_offer: toolOffer(view.best),
    gap_abs: view.gap?.amount ?? null,
    gap_pct: view.gap?.percent ?? null,
    reasons: view.reasons,
    receipt: view.lines,
    hold: view.hold === null ? null : { status: view.hold.status, expires_at: view.hold.expiresAt },
    follow_up_receipt_id: options.followUpId,
    simulated: view.simulated,
    payment_simulated: options.paymentSimulated,
    next_step: nextStep(view, options.replay),
  };
}

export function toolReport(view: ReportView): ToolReport {
  const r = view.report;
  const pct = (hundredths: number | null) =>
    hundredths === null ? null : percentFromHundredths(hundredths);
  return {
    attempted: r.attempted,
    paid: r.paid,
    rejected: r.rejected,
    held: r.held,
    captured: r.captured,
    not_cheapest: r.notCheapest,
    typical_overpay_pct: pct(r.medianGapPctHundredths),
    worst_overpay_pct: pct(r.worstGapPctHundredths),
    worst_overpay_abs: r.worstGapAbsCents === null ? null : formatUsd(r.worstGapAbsCents as Cents),
    steered: r.steered,
    conflicts: r.conflicts,
    report: view.lines,
  };
}

/** The receipt as an LLM reads it: the verdict, the owner's lines, what next, and the id. */
export function receiptText(receipt: ToolReceipt): string {
  const head = `${receipt.outcome} by ${receipt.rule}${receipt.replayed ? ` (a repeat: ${receipt.replay_reason}; the earlier decision stands)` : ""}.`;
  return [
    head,
    ...receipt.receipt,
    `Next: ${receipt.next_step}`,
    `receipt_id: ${receipt.receipt_id}`,
  ].join("\n");
}

/** A refusal: nothing was checked or recorded. RETRY_LIMIT names the decision that stands. */
export function refusalText(refusal: Refusal): string {
  const stands =
    refusal.receiptId === null
      ? ""
      : ` The decision that stands is receipt_id ${refusal.receiptId}.`;
  return `Refused (${refusal.reason}): ${refusal.message}${stands}`;
}
