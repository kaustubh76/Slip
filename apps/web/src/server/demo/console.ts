import "server-only";
import { type AppDeps, type CheckoutResult, issueAgentKey, listReceipts } from "@slip/app";
import { type Cents, formatUsd, type OwnerId } from "@slip/domain";
import { shortNo } from "@slip/receipt";
import { ERRANDS, type ErrandName, productIdFor } from "./catalogue";
import { type DemoFakes, runErrand } from "./desk";
import type { DemoDesk } from "./desks";
import type { ForcedOutcomes } from "./paypal";

/**
 * What the demo console does for one desk. Every errand goes through the real checkout as the
 * desk's own agent; a forced PayPal answer applies to that one purchase only; prices and outages
 * belong to this desk's copy of each product.
 */

export const PAYPAL_SCRIPTS = ["answers", "times-out", "declines", "stays-pending"] as const;
export type PayPalScript = (typeof PAYPAL_SCRIPTS)[number];

const FORCED: Readonly<Record<PayPalScript, ForcedOutcomes>> = {
  answers: {},
  // PayPal did the work but the answer never came back: the payment stays UNKNOWN until the
  // resolver asks PayPal again with the same request id.
  "times-out": { order: "timeout-after-commit" },
  declines: { order: "decline" },
  "stays-pending": { order: "pending" },
};

export interface Desk {
  deps: AppDeps;
  fakes: DemoFakes;
  ownerId: OwnerId;
  mandateId: string;
  /** The console's agent on each desk, by mandate; created on first use. */
  desks: Map<string, DemoDesk>;
}

export type ConsoleAnswer =
  | { status: "done"; message: string; receiptId: string | null }
  | { status: "refused"; message: string };

export const CONSOLE_AGENT = "shopper-2";

/**
 * The key of the console's own agent on this desk, issued on first use. Shopping as the seeded
 * shopper-1 would only replay the seed's decisions (Slip repeats a recent one rather than check
 * the same purchase twice); an agent of its own gets a fresh check on each errand's first run.
 */
async function agentKey(desk: Desk): Promise<string | null> {
  const known = desk.desks.get(desk.mandateId);
  if (known !== undefined) {
    return known.apiKey;
  }
  const issued = await issueAgentKey(desk.deps, desk.ownerId, desk.mandateId, {
    name: CONSOLE_AGENT,
  });
  if (issued.status !== "issued") {
    return null;
  }
  desk.desks.set(desk.mandateId, { agentId: issued.agent.id, apiKey: issued.apiKey });
  return issued.apiKey;
}

/** One errand by the desk's agent, with PayPal answering as scripted. */
export async function consoleErrand(
  desk: Desk,
  name: ErrandName,
  paypal: PayPalScript,
): Promise<ConsoleAnswer> {
  const apiKey = await agentKey(desk);
  if (apiKey === null) {
    return {
      status: "refused",
      message: "This permission cannot have an agent (it was cancelled).",
    };
  }
  const result = await runErrand(
    desk.deps,
    desk.fakes,
    { mandateId: desk.mandateId, apiKey },
    name,
    FORCED[paypal],
  );
  return describe(result);
}

function describe(result: CheckoutResult): ConsoleAnswer {
  if (result.status === "refused") {
    return { status: "refused", message: result.message };
  }
  const { attempt, payment } = result.receipt;
  const replayed = result.status === "replayed" ? " (a repeat: the earlier decision stands)" : "";
  return {
    status: "done",
    message: `${attempt.decision.outcome} by ${attempt.decision.ruleCode}, receipt no. ${shortNo(attempt.id)}; PayPal: ${payment?.status ?? "no order"}${replayed}.`,
    receiptId: attempt.id,
  };
}

/** PayPal finishes what it left pending for this desk; the resolver then reads the orders. */
export async function settlePending(desk: Desk): Promise<ConsoleAnswer> {
  const settled = await desk.fakes.gateway.settlePending(desk.mandateId);
  return {
    status: "done",
    receiptId: null,
    message:
      settled === 0
        ? "Nothing was pending at PayPal."
        : `PayPal settled ${settled} pending ${settled === 1 ? "payment" : "payments"}; Slip reads ${settled === 1 ? "it" : "them"} within seconds.`,
  };
}

/**
 * PayPal records a charge Slip never decided, against a purchase Slip refused.
 *
 * Nothing a stand-in does on its own can produce this: every record it reports comes from an
 * order Slip asked for, so the daily reconcile always agrees with itself and the one safeguard
 * that watches PayPal rather than the agent is invisible (D77). This is the disagreement, planted
 * — and it is the demo's own stand-in doing it, which the band on every page already says.
 */
export async function plantStrayCharge(desk: Desk): Promise<ConsoleAnswer> {
  const page = await listReceipts(desk.deps, desk.ownerId, desk.mandateId, { limit: 50 });
  const refused = page?.rows.find((row) => row.view.outcome === "REJECTED");
  if (refused === undefined) {
    return {
      status: "refused",
      message: "No refused purchase on this desk yet — run an errand Slip rejects first.",
    };
  }
  const cents = refused.view.chosen?.priceCents ?? 5_999;
  desk.fakes.gateway.addSettlement({
    invoiceId: refused.view.receiptId,
    amountCents: cents,
    kind: "settled",
  });
  return {
    status: "done",
    receiptId: refused.view.receiptId,
    message:
      `The stand-in PayPal now has a ${formatUsd(cents as Cents)} charge against a purchase Slip` +
      " refused. Slip compares its books with PayPal's every day; the permission slip says what" +
      " it cannot account for within a few seconds.",
  };
}

/** The standing desk's store raises its price — the case approving a hold must catch. */
export async function repriceDesk(desk: Desk, deltaCents: number): Promise<ConsoleAnswer> {
  const errand = ERRANDS["offers-down"];
  const price = desk.fakes.offers.reprice(
    productIdFor(errand.product, desk.mandateId),
    errand.chosenUrl,
    deltaCents,
  );
  return price === null
    ? { status: "refused", message: "That product is not listed on this desk." }
    : {
        status: "done",
        receiptId: null,
        message: `The standing desk is now listed at ${formatUsd(price)}. Slip sees the new price once its copy of the listing is a minute old.`,
      };
}

/** A key for the agent script, shown once. */
export async function scriptKey(
  desk: Desk,
): Promise<{ status: "issued"; apiKey: string } | { status: "refused"; message: string }> {
  const issued = await issueAgentKey(desk.deps, desk.ownerId, desk.mandateId, {
    name: "agent script",
  });
  return issued.status === "issued"
    ? { status: "issued", apiKey: issued.apiKey }
    : { status: "refused", message: issued.message };
}
