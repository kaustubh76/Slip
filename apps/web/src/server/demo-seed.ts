import "server-only";
import {
  type AppDeps,
  completeMandateSetup,
  issueAgentKey,
  registerOwner,
  runCheckout,
  startMandate,
} from "@slip/app";
import type { Offer } from "@slip/domain";
import type { Fakes } from "./runtime";

/**
 * A demo owner, set up the way a real one is: `registerOwner`, `startMandate`, the PayPal
 * approval (the fake's, since there are no sandbox keys), `completeMandateSetup`, then an agent
 * key. No shortcut past the use cases, so what the demo shows is what the application does.
 *
 * Then the agent goes shopping four times, through `runCheckout`, so every page has something
 * real on it: a purchase paid, one rejected, one held above the owner's cap, and one held because
 * Channel3 was down (which has no PayPal order behind it, the case an owner approves by paying in
 * one step).
 */

export interface DemoOwner {
  ownerId: string;
  mandateId: string;
  agentId: string;
  /** Shown once, so the demo agent script can call the checkout endpoint. */
  apiKey: string;
}

const offer = (price: number, domain: string, extra: Partial<Offer> = {}): Offer => ({
  url: `https://${domain}/p/${Math.round(price * 100)}`,
  domain,
  priceCents: Math.round(price * 100) as Offer["priceCents"],
  currency: "USD",
  availability: "InStock",
  condition: "new",
  commissionBps: 0,
  listingText: null,
  ...extra,
});

export async function seedDemoOwner(deps: AppDeps, fakes: Fakes): Promise<DemoOwner> {
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
  // What the owner does at PayPal; here the fake plays PayPal.
  fakes.gateway.approveSetup(started.mandate.setupOrderId ?? "");
  const active = await completeMandateSetup(deps, ownerId, mandateId);
  if (active.status !== "active") {
    throw new Error(`demo mandate did not activate: ${JSON.stringify(active)}`);
  }

  const issued = await issueAgentKey(deps, ownerId, mandateId, { name: "shopper-1" });
  if (issued.status !== "issued") {
    throw new Error(`demo agent: ${issued.message}`);
  }

  await shop(deps, fakes, issued.apiKey);
  return { ownerId, mandateId, agentId: issued.agent.id, apiKey: issued.apiKey };
}

async function shop(deps: AppDeps, fakes: Fakes, apiKey: string): Promise<void> {
  const trailShoe = offer(47.99, "store-b.example");
  const pricier = offer(58.99, "store-a.example", { commissionBps: 800 });
  fakes.offers.setProduct({
    productId: "trail-shoe",
    title: "Trail shoe",
    offers: [pricier, trailShoe, offer(52, "store-c.example")],
  });
  const lamp = offer(31.5, "store-f.example");
  fakes.offers.setProduct({
    productId: "desk-lamp",
    title: "Desk lamp",
    offers: [lamp, offer(33, "store-g.example")],
  });
  const headphones = offer(239, "store-k.example");
  fakes.offers.setProduct({
    productId: "headphones",
    title: "Headphones",
    offers: [headphones, offer(241, "store-h.example")],
  });

  const buy = async (productId: string, chosen: Offer, reason: string) => {
    const result = await runCheckout(deps, apiKey, {
      productId,
      chosenOfferUrl: chosen.url,
      reason,
    });
    if (result.status === "refused") {
      deps.log.warn("demo.checkout_refused", { productId, reason: result.reason });
    }
  };

  // Cheapest offer → paid in one step.
  await buy("desk-lamp", lamp, "cheapest I found");
  // $11 more than the same item elsewhere, and the pricier store pays more commission → rejected.
  await buy("trail-shoe", pricier, "Top pick badge");
  // Above the owner's $200 cap → held, with the money reserved.
  await buy("headphones", headphones, "best reviews");
  // Channel3 down → held with no PayPal order; approving re-checks and pays in one step. The
  // catalogue is stocked first and Channel3 comes back afterwards, which is the state that makes
  // approval possible: the item is listed again, so the re-check can price it.
  const desk = offer(310, "store-d.example");
  fakes.offers.setProduct({
    productId: "standing-desk",
    title: "Standing desk",
    offers: [desk, offer(316, "store-e.example")],
  });
  fakes.offers.goDown();
  await buy("standing-desk", desk, "only one I could find");
  fakes.offers.comeBack();
}
