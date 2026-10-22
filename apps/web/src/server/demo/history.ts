import "server-only";
import { type AppDeps, approveHold, declineHold, issueAgentKey, previewApproval } from "@slip/app";
import type { Clock, OwnerId } from "@slip/domain";
import type { ErrandName } from "./catalogue";
import { type DemoFakes, runErrand } from "./desk";
import type { ForcedOutcomes } from "./paypal";

/**
 * What this desk's agents did before today, so the roll is a roll rather than a burst: receipts
 * under two earlier dates, three agents to filter between, holds that were already decided, and
 * the payment states a desk that only ever succeeds never shows.
 *
 * Every step runs through `runCheckout` and the real hold use cases, exactly as the four purchases
 * of the present do — the only difference is the clock it is handed. That matters: the checkout
 * gate replays a repeat of the same (agent, product) within ten minutes and refuses a fifth
 * attempt on one product within an hour, so a history crammed into one instant would be mostly
 * replays. Spacing it over days is what makes it a history rather than a pile.
 *
 * One of the console's four PayPal scripts is deliberately absent. A forced timeout is not a fast
 * answer — it is no answer, and the purchase waits out `paypalTimeoutMs` before giving up — so a
 * seeded one would add four seconds to every sign-in to show a payment state that the resolver
 * clears a moment later anyway. UNKNOWN belongs to the console, where someone asked for it.
 */

/** The agents beside `shopper-1`, so the roll's filter has something to narrow. */
export const HISTORY_AGENTS = ["deal-hunter", "restock-bot"] as const;

interface Step {
  /** `shopper-1`, or one of `HISTORY_AGENTS`. */
  agent: string;
  errand: ErrandName;
  /** Whole days back from this morning, so the roll always spans three dates. */
  daysAgo: 1 | 2;
  /** The hour of that UTC day. One step per agent, per product, per hour: see the gate above. */
  hourUtc: number;
  /** What the stand-in PayPal did, when it is not the ordinary thing. */
  forced?: ForcedOutcomes;
  /** What the owner then did with the hold it left. Nothing is left pending. */
  decide?: "approve" | "decline";
}

/**
 * Oldest first. An approved hold with nothing reserved pays by a follow-up, which is a receipt of
 * its own, so this list is shorter than the roll it produces.
 */
const HISTORY: readonly Step[] = [
  { agent: "deal-hunter", errand: "lamp", daysAgo: 2, hourUtc: 9 },
  { agent: "deal-hunter", errand: "top-pick", daysAgo: 2, hourUtc: 10 },
  { agent: "deal-hunter", errand: "above-cap", daysAgo: 2, hourUtc: 11, decide: "decline" },
  { agent: "restock-bot", errand: "injected", daysAgo: 2, hourUtc: 12 },
  // Nothing was reserved, so approving checks again and pays: the follow-up receipt.
  { agent: "restock-bot", errand: "offers-down", daysAgo: 2, hourUtc: 13, decide: "approve" },
  { agent: "restock-bot", errand: "lamp", daysAgo: 2, hourUtc: 14, forced: { order: "decline" } },
  { agent: "shopper-1", errand: "cheaper", daysAgo: 2, hourUtc: 15 },
  { agent: "shopper-1", errand: "injected", daysAgo: 2, hourUtc: 16 },
  { agent: "shopper-1", errand: "offers-down", daysAgo: 2, hourUtc: 17, decide: "decline" },
  { agent: "deal-hunter", errand: "injected", daysAgo: 2, hourUtc: 18 },
  { agent: "restock-bot", errand: "top-pick", daysAgo: 2, hourUtc: 19 },

  { agent: "deal-hunter", errand: "cheaper", daysAgo: 1, hourUtc: 8 },
  { agent: "deal-hunter", errand: "offers-down", daysAgo: 1, hourUtc: 9, decide: "approve" },
  { agent: "deal-hunter", errand: "lamp", daysAgo: 1, hourUtc: 10 },
  { agent: "restock-bot", errand: "top-pick", daysAgo: 1, hourUtc: 11 },
  // Money was reserved and the owner let it through: the one capture of a hold on the desk.
  { agent: "restock-bot", errand: "above-cap", daysAgo: 1, hourUtc: 12, decide: "approve" },
  {
    agent: "restock-bot",
    errand: "cheaper",
    daysAgo: 1,
    hourUtc: 13,
    forced: { order: "pending" },
  },
  { agent: "restock-bot", errand: "injected", daysAgo: 1, hourUtc: 14 },
  { agent: "shopper-1", errand: "lamp", daysAgo: 1, hourUtc: 15 },
  { agent: "shopper-1", errand: "above-cap", daysAgo: 1, hourUtc: 16, decide: "decline" },
  { agent: "shopper-1", errand: "top-pick", daysAgo: 1, hourUtc: 17 },
  { agent: "deal-hunter", errand: "top-pick", daysAgo: 1, hourUtc: 18 },
  { agent: "restock-bot", errand: "lamp", daysAgo: 1, hourUtc: 19 },
  { agent: "shopper-1", errand: "cheaper", daysAgo: 1, hourUtc: 20 },
];

/** How many receipts the history is worth, for anything that needs to say so. */
export const HISTORY_RECEIPTS =
  HISTORY.length + HISTORY.filter((step) => step.decide === "approve" && pays(step)).length;

/** An approved hold pays by follow-up only when nothing was reserved to capture. */
function pays(step: Step): boolean {
  return step.errand === "offers-down";
}

/**
 * The same clock, `daysAgo` days and `hourUtc` hours from the start of today — a whole number of
 * UTC days back, never a fixed number of hours, so the roll spans three dates whatever time of day
 * the desk is opened, and every step is safely in the past.
 */
function at(clock: Clock, step: Step): Clock {
  const today = clock.now();
  const when = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate() - step.daysAgo,
    step.hourUtc,
  );
  return { now: () => new Date(when), sleep: (ms, signal) => clock.sleep(ms, signal) };
}

export interface HistoryDesk {
  ownerId: OwnerId;
  mandateId: string;
  /** Each agent's key, by name; `shopper-1` is already in it when this runs. */
  keys: Map<string, string>;
}

/** Issues the extra agents and walks `HISTORY`, oldest first. */
export async function seedHistory(
  deps: AppDeps,
  fakes: DemoFakes,
  desk: HistoryDesk,
): Promise<void> {
  for (const name of HISTORY_AGENTS) {
    const issued = await issueAgentKey(deps, desk.ownerId, desk.mandateId, { name });
    if (issued.status !== "issued") {
      throw new Error(`demo agent ${name}: ${issued.message}`);
    }
    desk.keys.set(name, issued.apiKey);
  }
  for (const step of HISTORY) {
    await runStep(deps, fakes, desk, step);
  }
}

async function runStep(
  deps: AppDeps,
  fakes: DemoFakes,
  desk: HistoryDesk,
  step: Step,
): Promise<void> {
  const apiKey = desk.keys.get(step.agent);
  if (apiKey === undefined) {
    throw new Error(`demo history: no key for ${step.agent}`);
  }
  const then = { ...deps, clock: at(deps.clock, step) };
  const result = await fakes.gateway.seedingAs(desk.mandateId, then.clock, () =>
    runErrand(then, fakes, { mandateId: desk.mandateId, apiKey }, step.errand, step.forced ?? {}),
  );
  if (result.status === "refused") {
    deps.log.warn("demo.history_refused", { ...step, reason: result.reason });
    return;
  }
  if (step.decide === undefined || result.receipt.hold === null) {
    return;
  }
  // An hour later, the owner decided. Left pending, a hold seeded two days ago would be past its
  // 48 hours, and the resolver would expire it while the visitor was reading the page.
  const decided = { ...deps, clock: at(deps.clock, { ...step, hourUtc: step.hourUtc + 1 }) };
  const id = result.receipt.attempt.id;
  await fakes.gateway.seedingAs(desk.mandateId, decided.clock, async () => {
    if (step.decide === "decline") {
      const closed = await declineHold(decided, desk.ownerId, id);
      if (closed.status === "refused") {
        deps.log.warn("demo.history_decline_refused", { ...step, reason: closed.reason });
      }
      return;
    }
    const preview = await previewApproval(decided, desk.ownerId, id);
    if (preview.status !== "preview") {
      deps.log.warn("demo.history_preview_refused", { ...step, reason: preview.reason });
      return;
    }
    const approved = await approveHold(decided, desk.ownerId, id, {
      expectedAmountCents: preview.amountCents,
    });
    if (approved.status === "refused") {
      deps.log.warn("demo.history_approve_refused", { ...step, reason: approved.reason });
    }
  });
}
