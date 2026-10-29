import { DEFAULT_POLICY, type Offer, type Policy, policyWith } from "@slip/domain";
import { offer, snapshot, testAttempt, testDecision, testUuid } from "@slip/domain/testing";
import type {
  AgentCard,
  Holds,
  MandateSummary,
  PolicyView,
  ReceiptDetail,
  ReceiptPage,
  ReceiptRow,
  ReceiptView,
} from "@slip/receipt";
import { offerRows, renderReceipt } from "@slip/receipt";
import { hold, payment } from "@slip/receipt/testing";
import { heldView, paidView, rejectedView, releasedView } from "./views.js";

/**
 * One whole Slip, canned — everything `SlipClient` can be asked for, not just the receipt views.
 *
 * `./views.js` covers the five receipt states and nothing else, so most of the kit has never had
 * anything to be drawn from. These are the rest, and they are built the way those are: through the
 * real renderers (`renderReceipt`, `offerRows`) over the domain's own test builders, so a fixture
 * cannot quietly disagree with what production would produce from the same facts.
 *
 * This is built, not test-only, because `FakeSlipClient` defaults to it and the kit gallery is a
 * real page. Everything it leans on is a published entry: `@slip/domain/testing` always was one,
 * and `@slip/receipt/testing` became one for this.
 *
 * Every amount here is a fixture amount. Nothing in this file is a real store's price.
 */

const AGENTS = [
  { id: testUuid(1), name: "shopper" },
  { id: testUuid(2), name: "researcher" },
] as const;

export { approvedByFollowUpView, heldView, paidView, rejectedView, releasedView } from "./views.js";

export function agentNames(): { id: string; name: string }[] {
  return AGENTS.map((agent) => ({ ...agent }));
}

/** The roll: a mix of outcomes, newest first, so the summary and the filter have work to do. */
export function rollRows(): ReceiptRow[] {
  const [first, second] = AGENTS;
  const of = (view: ReceiptView, at: number, who: { id: string; name: string }): ReceiptRow => ({
    view: { ...view, receiptId: `fixture-${at}` },
    agent: { ...who },
  });
  return [
    of(rejectedView(), 1, first),
    of(heldView(), 2, first),
    of(paidView(), 3, second),
    of(releasedView(), 4, second),
    of(paidView(), 5, first),
    of(rejectedView(), 6, second),
  ];
}

export function receiptPage(rows: readonly ReceiptRow[] = rollRows()): ReceiptPage {
  return { rows: rows.map((row) => ({ ...row })), next: null };
}

/** The in-tray: what is waiting, and what was decided most recently. */
export function holdsTray(): Holds {
  const rows = rollRows();
  return {
    pending: rows.filter((row) => row.view.outcome === "HELD"),
    decided: rows.filter((row) => row.view.outcome !== "HELD").slice(0, 2),
  };
}

/** One receipt with everything behind it, assembled as `packages/app/src/owner/queries.ts` does. */
export function receiptDetail(): ReceiptDetail {
  const chosen: Offer = offer({ price: 58.99, domain: "store-a.example", rate: 0.08 });
  const best: Offer = offer({ price: 47.99, domain: "store-b.example", rate: 0.02 });
  const shelf = snapshot({
    offers: [chosen, best, offer({ price: 52, domain: "store-c.example" })],
  });
  const attempt = testAttempt({
    decision: testDecision({ ruleCode: "R4_OVERPAID", chosen, best, conflict: true }),
  });
  const view = renderReceipt(
    { attempt, payment: null, hold: null },
    { policy: DEFAULT_POLICY, snapshot: shelf },
  );
  return {
    view,
    agent: { ...(AGENTS[0] as { id: string; name: string }) },
    parent: null,
    followUp: null,
    timeline: [],
    offers: offerRows(shelf, attempt.decision.checkResult),
  };
}

/** A held receipt with its whole payment history, which is the one that has a timeline. */
export function heldDetail(): ReceiptDetail {
  const attempt = testAttempt({
    decision: testDecision({
      ruleCode: "R6_ABOVE_ORDER_CAP",
      chosen: offer({ price: 239, domain: "store-a.example" }),
    }),
  });
  const view = renderReceipt(
    { attempt, payment: payment(attempt, "AUTHORIZED"), hold: hold(attempt, "PENDING") },
    { policy: DEFAULT_POLICY },
  );
  return {
    view,
    agent: { ...(AGENTS[1] as { id: string; name: string }) },
    parent: null,
    followUp: null,
    timeline: [
      { at: "2026-10-29T09:00:00.000Z", from: "NONE", to: "INITIATED" },
      { at: "2026-10-29T09:00:02.000Z", from: "INITIATED", to: "AUTHORIZED" },
    ],
    offers: [],
  };
}

const asView = (policy: Policy): PolicyView => ({
  version: policy.version,
  maxOverpayPctHundredths: policy.maxOverpayPctHundredths,
  maxOverpayAbsCents: policy.maxOverpayAbsCents,
  flagPctHundredths: policy.flagPctHundredths,
  orderCapCents: policy.orderCapCents,
  snapshotMaxAgeMs: policy.snapshotMaxAgeMs,
});

/** Two versions, newest first, so the limits page has a history to show and a version to base on. */
export function policyVersions(): PolicyView[] {
  const raised = policyWith(DEFAULT_POLICY, { orderCapCents: 50_000 });
  return [asView(raised), asView(DEFAULT_POLICY)];
}

export function agentCards(): AgentCard[] {
  const card = (
    who: { id: string; name: string },
    over: Partial<AgentCard["report"]["report"]> = {},
    revokedAt: string | null = null,
  ): AgentCard => ({
    agent: {
      id: who.id,
      name: who.name,
      apiKeyPrefix: `slip_${who.name.slice(0, 4)}`,
      createdAt: "2026-10-01T09:00:00.000Z",
      revokedAt,
    },
    report: {
      report: {
        agentId: who.id,
        attempted: 12,
        paid: 8,
        rejected: 3,
        held: 1,
        captured: 8,
        notCheapest: 4,
        medianGapPctHundredths: 180,
        worstGapPctHundredths: 2_290,
        worstGapAbsCents: 1_100,
        steered: 1,
        conflicts: 2,
        ...over,
      },
      lines: [],
    },
  });
  return [
    card(AGENTS[0] as { id: string; name: string }),
    card(
      AGENTS[1] as { id: string; name: string },
      {
        attempted: 0,
        paid: 0,
        rejected: 0,
        held: 0,
        captured: 0,
        notCheapest: 0,
        steered: 0,
        conflicts: 0,
        medianGapPctHundredths: null,
        worstGapPctHundredths: null,
        worstGapAbsCents: null,
      },
      "2026-10-20T12:00:00.000Z",
    ),
  ];
}

export function mandateSummary(over: Partial<MandateSummary> = {}): MandateSummary {
  return {
    id: testUuid(9),
    status: "ACTIVE",
    awaitingPayPal: false,
    hasSavedMethod: true,
    createdAt: "2026-10-01T09:00:00.000Z",
    activatedAt: "2026-10-01T09:05:00.000Z",
    revokedAt: null,
    savedMethodDeletedAt: null,
    policyVersion: 2,
    pendingHolds: 1,
    agents: 2,
    reconciledAt: "2026-10-29T06:00:00.000Z",
    reconcileUnmatched: 0,
    ...over,
  };
}
