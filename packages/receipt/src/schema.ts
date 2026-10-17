import {
  HOLD_STATUSES,
  MANDATE_STATUSES,
  OutcomeSchema,
  PAYMENT_STATUSES,
  RuleCodeSchema,
} from "@slip/domain";
import { z } from "zod";

/**
 * The receipt view as it crosses a wire — to the owner's browser, an MCP client or a platform
 * embedding the receipt. Plain JSON: times are ISO 8601 strings in UTC, ids are strings. The
 * renderer's output type is inferred from this schema, so the two cannot disagree, and a client
 * can check what it received (also published alone as `@slip/receipt/schema`).
 */

const isoTime = z.iso.datetime();

export const OfferSummarySchema = z.object({
  domain: z.string(),
  /** How the store is named in sentences: "Store A", or the domain without `www.`. */
  store: z.string(),
  url: z.string(),
  priceCents: z.number().int(),
  price: z.string(),
  /** "8%" when the store's commission is known and above zero. */
  commission: z.string().nullable(),
});
export type OfferSummary = z.infer<typeof OfferSummarySchema>;

export const StateLineSchema = z.object({
  glyph: z.enum(["[ ]", "[x]", "[-]", "[!]", "[?]"]).nullable(),
  word: z.enum(PAYMENT_STATUSES),
  text: z.string(),
  inFlight: z.boolean(),
  charged: z.boolean(),
});

const MarkSchema = z.object({ cents: z.number().int(), x: z.number().int(), label: z.string() });

/** The gap scale (see `measureModel`): integer positions on a 0–1000 scale. */
export const MeasureSchema = z.object({
  width: z.literal(1000),
  /** The lowest listed price: the left end of the line. */
  low: MarkSchema,
  /** How far "within your limits" reaches. */
  limit: MarkSchema,
  /** The agent's choice. */
  chosen: MarkSchema,
  /** The owner's order cap, when it decided or tripped. */
  cap: MarkSchema.nullable(),
  /** Other comparable offers, when the snapshot is known. */
  ticks: z.array(z.object({ cents: z.number().int(), x: z.number().int() })),
  /** "+$3.00 past your limit", or null when the choice is within the limits. */
  pastLimit: z.string().nullable(),
  /** The scale in words; the drawing itself is decoration. */
  caption: z.string(),
});
export type Measure = z.infer<typeof MeasureSchema>;

/**
 * For a hold still waiting for its owner: how approving would work (`capture`, `pay`,
 * `not-ready`, `spent`, see `approvalPath`); `none` otherwise. A hint for drawing the slip only —
 * approving always asks the server first.
 */
export const APPROVAL_HINTS = ["capture", "pay", "not-ready", "spent", "none"] as const;

export const ReceiptViewSchema = z.object({
  receiptId: z.string(),
  outcome: OutcomeSchema,
  ruleCode: RuleCodeSchema,
  /** One plain sentence per rule that tripped, deciding rule first (the rules behind it). */
  reasons: z.array(z.string()),
  /** The whole five-second receipt, in reading order: opening, verdict, state line, footer. */
  lines: z.array(z.string()),
  /** What the agent picked against the lowest listed price. */
  opening: z.array(z.string()),
  /** The decision, by the rule that decided it. */
  verdict: z.string(),
  /** Where the prices came from and what they leave out. */
  footer: z.string(),
  /**
   * The prices came from the demo's stand-in catalogue, not Channel3: the stores and their pages
   * do not exist, so a reader must not offer a link to them.
   */
  simulated: z.boolean(),
  /**
   * Why the agent said it chose this offer — its own words, quoted on the receipt and labelled as
   * untrusted, because no rule reads it (D4).
   */
  agentReason: z.string(),
  chosen: OfferSummarySchema.nullable(),
  best: OfferSummarySchema.nullable(),
  gap: z.object({ cents: z.number().int(), amount: z.string(), percent: z.string() }).nullable(),
  /** The gap scale, or null when the check did not compare prices. */
  measure: MeasureSchema.nullable(),
  /** This attempt's own payment; `NONE` when it has no PayPal order. */
  paymentStatus: z.enum(PAYMENT_STATUSES),
  /** True only when this attempt's own payment moved money (it is CAPTURED). */
  charged: z.boolean(),
  /** What PayPal is holding for this purchase right now, or null when it holds nothing. */
  reservedCents: z.number().int().nullable(),
  /**
   * Where the money stands, in one line decided from the payment, the hold and any follow-up
   * together. `state.charged` is true when money moved for this purchase, including through the
   * owner-approval attempt that paid for a hold.
   */
  state: StateLineSchema,
  paypal: z
    .object({
      orderId: z.string().nullable(),
      authorizationId: z.string().nullable(),
      captureId: z.string().nullable(),
    })
    .nullable(),
  hold: z
    .object({
      status: z.enum(HOLD_STATUSES),
      expiresAt: isoTime,
      decidedAt: isoTime.nullable(),
      /** Who decided: the owner, or Slip itself (expiry, or releasing holds after a revoke). */
      decidedBy: z.enum(["owner", "system"]).nullable(),
    })
    .nullable(),
  approval: z.enum(APPROVAL_HINTS),
  policyVersion: z.number().int().min(1),
  snapshotId: z.string().nullable(),
  pricesAt: isoTime.nullable(),
  createdAt: isoTime,
});
export type ReceiptView = z.infer<typeof ReceiptViewSchema>;

// ---------- the owner's pages ----------
//
// What the owner's read API returns, page by page. The application's owner queries produce exactly
// these shapes (a test parses every query result with them), and a client checks what it receives.

export const AgentNameSchema = z.object({ id: z.string(), name: z.string() });

/** A receipt as one row of the roll or the tray: its view and the agent that made it. */
export const ReceiptRowSchema = z.object({ view: ReceiptViewSchema, agent: AgentNameSchema });
export type ReceiptRow = z.infer<typeof ReceiptRowSchema>;

/** One page of the roll, newest first. `next` is an opaque cursor for older receipts. */
export const ReceiptPageSchema = z.object({
  rows: z.array(ReceiptRowSchema),
  next: z.string().nullable(),
});
export type ReceiptPage = z.infer<typeof ReceiptPageSchema>;

/** Why an offer in the snapshot took no part in the price comparison. */
export const NOT_COMPARED = [
  "out of stock",
  "used",
  "condition not stated",
  "price unknown",
  "other currency",
  "listed twice",
  "prices too old",
] as const;

/** One offer the snapshot listed, for the table behind the receipt. */
export const OfferRowSchema = z.object({
  store: z.string(),
  domain: z.string(),
  /** Only an http(s) address; anything else is not offered as a link. */
  link: z.string().nullable(),
  price: z.string().nullable(),
  priceCents: z.number().int().nullable(),
  currency: z.string(),
  inStock: z.boolean(),
  condition: z.enum(["new", "used", "not stated"]),
  /** "8%" when the store's commission is known and above zero. */
  commission: z.string().nullable(),
  /** BEST: the lowest comparable price. CHOSEN: the agent's pick. */
  best: z.boolean(),
  chosen: z.boolean(),
  compared: z.boolean(),
  notCompared: z.enum(NOT_COMPARED).nullable(),
});
export type OfferRow = z.infer<typeof OfferRowSchema>;

export const TimelineRowSchema = z.object({
  at: isoTime,
  from: z.enum(PAYMENT_STATUSES),
  to: z.enum(PAYMENT_STATUSES),
});

/** One receipt with everything behind it. */
export const ReceiptDetailSchema = ReceiptRowSchema.extend({
  /** For an owner-approval attempt: the hold it paid for. */
  parent: ReceiptViewSchema.nullable(),
  /** For an approved hold with no reservation: the attempt that paid for it. */
  followUp: ReceiptViewSchema.nullable(),
  /** The payment's status changes, oldest first. */
  timeline: z.array(TimelineRowSchema),
  /** Every offer the snapshot listed, in its order; empty when there was no snapshot. */
  offers: z.array(OfferRowSchema),
});
export type ReceiptDetail = z.infer<typeof ReceiptDetailSchema>;

/** The in-tray: holds waiting (soonest to expire first) and the most recently decided. */
export const HoldsSchema = z.object({
  pending: z.array(ReceiptRowSchema),
  decided: z.array(ReceiptRowSchema),
});
export type Holds = z.infer<typeof HoldsSchema>;

const count = z.number().int().min(0);

export const AgentReportSchema = z.object({
  agentId: z.string(),
  attempted: count,
  paid: count,
  rejected: count,
  held: count,
  captured: count,
  notCheapest: count,
  medianGapPctHundredths: count.nullable(),
  worstGapPctHundredths: count.nullable(),
  worstGapAbsCents: count.nullable(),
  steered: count,
  conflicts: count,
});

export const AgentCardSchema = z.object({
  agent: z.object({
    id: z.string(),
    name: z.string(),
    /** The first characters of the key, so the owner can recognise it. Never the key. */
    apiKeyPrefix: z.string(),
    createdAt: isoTime,
    revokedAt: isoTime.nullable(),
  }),
  report: z.object({ report: AgentReportSchema, lines: z.array(z.string()) }),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;

/** One version of the owner's limits, as plain numbers (cents, hundredths of a percent, ms). */
export const PolicyViewSchema = z.object({
  version: z.number().int().min(1),
  maxOverpayPctHundredths: count,
  maxOverpayAbsCents: count,
  flagPctHundredths: count,
  orderCapCents: count,
  snapshotMaxAgeMs: count,
});
export type PolicyView = z.infer<typeof PolicyViewSchema>;

export const MandateSummarySchema = z.object({
  id: z.string(),
  status: z.enum(MANDATE_STATUSES),
  /** PENDING with a PayPal setup started: the owner still has to approve at PayPal. */
  awaitingPayPal: z.boolean(),
  hasSavedMethod: z.boolean(),
  createdAt: isoTime,
  activatedAt: isoTime.nullable(),
  revokedAt: isoTime.nullable(),
  /** When PayPal confirmed the saved method was deleted after a revoke. */
  savedMethodDeletedAt: isoTime.nullable(),
  policyVersion: z.number().int().min(1),
  pendingHolds: count,
  agents: count,
});
export type MandateSummary = z.infer<typeof MandateSummarySchema>;
