import "server-only";
import {
  type AppDeps,
  completeMandateSetup,
  issueAgentKey,
  registerOwner,
  startMandate,
} from "@slip/app";
import { type DemoFakes, runErrand, stockDesk } from "./desk";

/**
 * A demo owner, set up the way a real one is: `registerOwner`, `startMandate`, the PayPal
 * approval (the stand-in's, since there are no sandbox keys), `completeMandateSetup`, then an
 * agent key. No shortcut past the use cases, so what the demo shows is what the application does.
 *
 * Then the agent runs four errands through `runCheckout`, so every page has something real on it:
 * a purchase paid, one rejected, one held above the owner's cap, and one held because Channel3 was
 * down (which has no PayPal order behind it, the case an owner approves by paying in one step).
 * Everything happens on this desk's own products, so two visitors signing in at once never see
 * each other's outage or prices.
 */

export interface DemoOwner {
  ownerId: string;
  mandateId: string;
  agentId: string;
  /** The agent's key, kept server-side so the demo console can shop as this desk's agent. */
  apiKey: string;
}

export async function seedDemoOwner(deps: AppDeps, fakes: DemoFakes): Promise<DemoOwner> {
  const owner = await registerOwner(deps, { email: null });
  if (owner.status !== "registered") {
    throw new Error(`demo owner: ${owner.message}`);
  }
  const ownerId = owner.owner.id;

  const started = await startMandate(deps, ownerId, {});
  if (started.status !== "started") {
    throw new Error(`demo mandate: ${started.message}`);
  }
  const mandateId = started.mandate.id;
  // What the owner does at PayPal; here the stand-in plays PayPal.
  fakes.gateway.approveSetup(started.mandate.setupOrderId ?? "");
  const active = await completeMandateSetup(deps, ownerId, mandateId);
  if (active.status !== "active") {
    throw new Error(`demo mandate did not activate: ${JSON.stringify(active)}`);
  }

  const issued = await issueAgentKey(deps, ownerId, mandateId, { name: "shopper-1" });
  if (issued.status !== "issued") {
    throw new Error(`demo agent: ${issued.message}`);
  }
  const desk = { mandateId, apiKey: issued.apiKey };
  stockDesk(fakes.offers, mandateId);
  for (const errand of ["lamp", "top-pick", "above-cap", "offers-down"] as const) {
    const result = await runErrand(deps, fakes, desk, errand);
    if (result.status === "refused") {
      deps.log.warn("demo.checkout_refused", { errand, reason: result.reason });
    }
  }
  return { ownerId, mandateId, agentId: issued.agent.id, apiKey: issued.apiKey };
}
