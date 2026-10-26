import {
  approvalPath,
  formatPct,
  formatUsd,
  type Hold,
  type Offer,
  type OfferSnapshot,
  type Policy,
  type Receipt,
  SYSTEM_DECIDER,
} from "@slip/domain";
import { measureModel } from "./measure.js";
import { gapPercent } from "./percent.js";
import type { OfferSummary, ReceiptView } from "./schema.js";
import { footer, openingLines, type PricesSource, ruleSentence, verdict } from "./sentences.js";
import { stateLine } from "./state.js";
import { storeName } from "./store-name.js";

/**
 * The receipt as people read it — the owner in five seconds, the agent as structured fields.
 * Every number is filled in here from the stored record, never by a language model, and the words
 * stay plain: dollars and percent, "listed item price", no trading jargon.
 */

function summary(offer: Offer | null): OfferSummary | null {
  if (offer === null || offer.priceCents === null) {
    return null;
  }
  return {
    domain: offer.domain,
    store: storeName(offer.domain),
    url: offer.url,
    priceCents: offer.priceCents,
    price: formatUsd(offer.priceCents),
    commission:
      offer.commissionBps !== null && offer.commissionBps > 0
        ? formatPct(offer.commissionBps)
        : null,
  };
}

export interface RenderOptions {
  /** The policy at the version the attempt was checked under; adds the owner's own numbers. */
  policy?: Policy;
  /** For an approved hold with no reservation: the owner-approval attempt that paid for it. */
  child?: Receipt | null;
  /**
   * The snapshot the attempt was checked against: names the listed variant on a mismatch, and
   * puts the other comparable offers on the gap scale.
   */
  snapshot?: OfferSnapshot | null;
  /**
   * Who served the prices. `simulated` (a demo on the stand-in catalogue) changes the footer and
   * marks the view, so nothing on the receipt implies a real store or real Channel3 listing.
   */
  pricesSource?: PricesSource;
}

export function renderReceipt(receipt: Receipt, options: RenderOptions = {}): ReceiptView {
  const { attempt, payment, hold } = receipt;
  const { decision } = attempt;
  const result = decision.checkResult;
  const chosen = summary(result.chosen);
  const best = summary(result.best);
  const bestCents = result.best?.priceCents ?? null;
  const gap =
    result.gapAbsCents !== null && bestCents !== null && result.gapAbsCents > 0
      ? {
          cents: result.gapAbsCents,
          amount: formatUsd(result.gapAbsCents),
          percent: gapPercent(
            result.gapAbsCents,
            bestCents,
            decision.ruleCode === "R4_OVERPAID" && options.policy !== undefined
              ? { above: options.policy.maxOverpayPctHundredths }
              : {},
          ),
        }
      : null;
  const reasons = result.ruleCodes.map((code) => ruleSentence(code, options.policy));
  const opening = openingLines({
    chosen,
    best,
    gap,
    ruleCode: decision.ruleCode,
    conflict: result.conflict,
    chosenUrl: attempt.chosenOfferUrl,
  });
  const decided = verdict({
    attempt,
    chosen,
    chosenOffer: result.chosen,
    policy: options.policy,
    snapshot: options.snapshot ?? null,
  });
  const state = stateLine(receipt, { store: chosen?.store ?? null, child: options.child ?? null });
  const source = options.pricesSource ?? "channel3";
  const foot = footer(result.snapshotFetchedAt, attempt.createdAt, source);
  // A rejection's verdict already says what happened to the money; otherwise the state line does.
  const lines = [
    ...opening,
    decided,
    ...(decision.outcome === "REJECTED" ? [] : [state.text]),
    foot,
  ];

  return {
    receiptId: attempt.id,
    outcome: decision.outcome,
    ruleCode: decision.ruleCode,
    reasons,
    lines,
    opening,
    verdict: decided,
    footer: foot,
    simulated: source === "simulated",
    agentReason: attempt.reason,
    // Both shown exactly when a rule read them: the classifier runs only above a 1 % gap, so
    // `NOT_RUN` means nothing judged this purchase and there is nothing to evidence. The two
    // halves of what it was shown — the merchant's own listing, and what Slip's search showed the
    // agent — and on real data only the second is ever there (D86, D87).
    listingText:
      decision.checkResult.classifier === "NOT_RUN"
        ? null
        : (decision.checkResult.chosen?.listingText ?? null),
    searchText:
      decision.checkResult.classifier === "NOT_RUN" ? null : decision.checkResult.searchContext,
    chosen,
    best,
    gap,
    measure: measureModel(receipt, options.policy, options.snapshot ?? null),
    paymentStatus: payment?.status ?? "NONE",
    charged: payment?.status === "CAPTURED",
    reservedCents: payment?.status === "AUTHORIZED" ? payment.amountCents : null,
    state,
    paypal:
      payment === null
        ? null
        : {
            orderId: payment.paypalOrderId,
            authorizationId: payment.authorizationId,
            captureId: payment.captureId,
          },
    hold: hold === null ? null : holdView(hold),
    approval: hold?.status === "PENDING" ? approvalPath(payment) : "none",
    policyVersion: result.policyVersion,
    snapshotId: result.snapshotId,
    pricesAt: result.snapshotFetchedAt?.toISOString() ?? null,
    createdAt: attempt.createdAt.toISOString(),
  };
}

/** Who decided is "owner" or "system"; the owner's id itself stays out of the view. */
function holdView(hold: Hold): NonNullable<ReceiptView["hold"]> {
  return {
    status: hold.status,
    expiresAt: hold.expiresAt.toISOString(),
    decidedAt: hold.decidedAt?.toISOString() ?? null,
    decidedBy:
      hold.decidedBy === null ? null : hold.decidedBy === SYSTEM_DECIDER ? "system" : "owner",
  };
}
