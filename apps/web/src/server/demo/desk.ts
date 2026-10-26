import "server-only";
import { type AppDeps, authenticate, type CheckoutResult, runCheckout } from "@slip/app";
import { recordingSearch, SEARCH_LIMIT } from "@slip/mcp";
import { DEMO_PRODUCTS, ERRANDS, type ErrandName, productIdFor } from "./catalogue";
import type { DemoOffers } from "./offers";
import type { DemoPayPal, ForcedOutcomes } from "./paypal";
import { deskSearch } from "./search";

/** The stand-ins one demo needs, shared by every visitor's desk. */
export interface DemoFakes {
  offers: DemoOffers;
  gateway: DemoPayPal;
}

/** Lists every demo product under this desk's own ids. */
export function stockDesk(offers: DemoOffers, mandateId: string): void {
  for (const product of DEMO_PRODUCTS) {
    offers.setProduct({
      productId: productIdFor(product.base, mandateId),
      title: product.title,
      offers: product.offers,
    });
  }
}

/**
 * One errand by this desk's agent: a search, then the real checkout.
 *
 * **The search is not decoration.** On real data the only text about a product is the product's
 * own, served by Slip's search and recorded as what the agent was shown — that impression is what
 * the steering check is asked about and what the receipt quotes (D69, D87). An errand that went
 * straight to checkout recorded nothing, so the demo could only ever exercise the offer-level text
 * that no real listing has, which is the mirror image of production (D88). A real agent searches
 * first, and the MCP script always did.
 *
 * `forced` scripts what (simulated) PayPal answers to this purchase alone; an errand that needs
 * Channel3 down takes down only this desk's copy of the product, and only while it runs.
 */
export async function runErrand(
  deps: AppDeps,
  fakes: DemoFakes,
  desk: { mandateId: string; apiKey: string },
  name: ErrandName,
  forced: ForcedOutcomes = {},
): Promise<CheckoutResult> {
  const errand = ERRANDS[name];
  const productId = productIdFor(errand.product, desk.mandateId);
  await lookFirst(deps, fakes, desk, name);
  const checkout = () =>
    runCheckout(deps, desk.apiKey, {
      productId,
      chosenOfferUrl: errand.chosenUrl,
      reason: errand.reason,
    });
  if (errand.offline === true) {
    fakes.offers.setDown(productId, true);
  }
  try {
    return await fakes.gateway.withForced(desk.mandateId, forced, checkout);
  } finally {
    if (errand.offline === true) {
      fakes.offers.setDown(productId, false);
    }
  }
}

/**
 * The agent's search, before it decides. A failure here is swallowed: the checkout is the thing
 * under demonstration, and `recordShown` already treats a lost impression as costing one steering
 * verdict rather than the agent's results.
 */
async function lookFirst(
  deps: AppDeps,
  fakes: DemoFakes,
  desk: { mandateId: string; apiKey: string },
  name: ErrandName,
): Promise<void> {
  const auth = await authenticate(deps, desk.apiKey);
  if ("status" in auth) {
    // Revoked, or a mandate that is not active. The checkout will say so in its own words.
    return;
  }
  const search = recordingSearch(deps, auth.agent.id, deskSearch(fakes.offers, desk.mandateId));
  await search.search(
    ERRANDS[name].query,
    { limit: SEARCH_LIMIT.default },
    new AbortController().signal,
  );
}
