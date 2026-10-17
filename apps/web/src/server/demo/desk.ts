import "server-only";
import { type AppDeps, type CheckoutResult, runCheckout } from "@slip/app";
import { DEMO_PRODUCTS, ERRANDS, type ErrandName, productIdFor } from "./catalogue";
import type { DemoOffers } from "./offers";
import type { DemoPayPal, ForcedOutcomes } from "./paypal";

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
 * One errand by this desk's agent, through the real checkout. `forced` scripts what (simulated)
 * PayPal answers to this purchase alone; an errand that needs Channel3 down takes down only this
 * desk's copy of the product, and only while it runs.
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
