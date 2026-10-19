import "server-only";
import type { AppDeps } from "@slip/app";
import type { OffersSource, PaymentGateway, SteeringClassifier, Store } from "@slip/domain";
import { createChannel3Offers } from "@slip/offers";
import { FakeOffersSource } from "@slip/offers/fake";
import { createPayPalGateway, PAYPAL_LIVE_BASE_URL, PAYPAL_SANDBOX_BASE_URL } from "@slip/paypal";
import { FakePaymentGateway } from "@slip/paypal/fake";
import { createClaudeSteeringClassifier } from "@slip/steering";
import { FakeSteeringClassifier } from "@slip/steering/fake";
import { DEMO_PRODUCTS, INJECTION_PHRASE } from "./demo/catalogue";
import { DemoOffers } from "./demo/offers";
import { DemoPayPal } from "./demo/paypal";
import { demoLatencyMs } from "./demo/timing";
import { type CatalogueSearch, createCatalogueSearch } from "./search";
import type { Services } from "./services";

/**
 * The three outside services, each on its own: the real adapter when its keys are set, its
 * stand-in otherwise (D63, D64). A run with PayPal's sandbox keys and nothing else pays through
 * the sandbox while prices come from the stand-in catalogue and the stand-in classifier answers.
 *
 * Outside the demo the stand-in catalogue holds every demo product once, under its plain id
 * (`trail-shoe`), so an agent has something to buy. The demo stocks a copy per desk instead, under
 * that desk's own ids, and never the plain ones: one visitor's catalogue must not leak to another.
 */

export interface StandIns {
  offers: DemoOffers | null;
  gateway: DemoPayPal | null;
  classifier: FakeSteeringClassifier | null;
}

export interface Assembled {
  offers: OffersSource;
  gateway: PaymentGateway;
  classifier: SteeringClassifier;
  /**
   * The catalogue agents search, when there is a real one. Null with simulated prices: the demo
   * serves its own desk catalogue, and a stand-in catalogue outside the demo would offer an agent
   * product ids Channel3 has never heard of.
   */
  catalogue: CatalogueSearch | null;
  /** The stand-in behind each simulated service; null where the service is real. */
  standIns: StandIns;
}

export function assembleServices(input: {
  services: Services;
  env: NodeJS.ProcessEnv;
  store: Store;
  clock: AppDeps["clock"];
  log: AppDeps["log"];
  demo: boolean;
  publicBaseUrl: string;
}): Assembled {
  const { services, env } = input;
  const standIns: StandIns = {
    offers: services.prices === "simulated" ? catalogue(input.demo) : null,
    gateway:
      services.payment === "simulated"
        ? new DemoPayPal({
            inner: new FakePaymentGateway({ clock: input.clock }),
            store: input.store,
            clock: input.clock,
            latencyMs: input.demo ? demoLatencyMs(env["SLIP_DEMO_LATENCY_MS"]) : 0,
            publicBaseUrl: input.publicBaseUrl,
          })
        : null,
    classifier: services.steering === "simulated" ? simulatedClassifier() : null,
  };
  return {
    catalogue:
      services.prices === "channel3"
        ? createCatalogueSearch({
            apiKey: required(env, "CHANNEL3_API_KEY"),
            clock: input.clock,
            log: input.log,
          })
        : null,
    offers: standIns.offers ?? createChannel3Offers({ apiKey: required(env, "CHANNEL3_API_KEY") }),
    gateway:
      standIns.gateway ??
      createPayPalGateway({
        clientId: required(env, "PAYPAL_CLIENT_ID"),
        clientSecret: required(env, "PAYPAL_CLIENT_SECRET"),
        webhookId: required(env, "PAYPAL_WEBHOOK_ID"),
        baseUrl: services.payment === "live" ? PAYPAL_LIVE_BASE_URL : PAYPAL_SANDBOX_BASE_URL,
        brandName: new URL(input.publicBaseUrl).hostname,
      }),
    classifier:
      standIns.classifier ??
      createClaudeSteeringClassifier({ apiKey: required(env, "ANTHROPIC_API_KEY") }),
    standIns,
  };
}

function catalogue(demo: boolean): DemoOffers {
  const offers = new DemoOffers(new FakeOffersSource());
  if (!demo) {
    for (const product of DEMO_PRODUCTS) {
      offers.setProduct({ productId: product.base, title: product.title, offers: product.offers });
    }
  }
  return offers;
}

function simulatedClassifier(): FakeSteeringClassifier {
  const classifier = new FakeSteeringClassifier();
  // The demo catalogue's steered listing carries this note; the stand-in calls it instruction-like.
  classifier.flagWhenListingIncludes(INJECTION_PHRASE);
  return classifier;
}

/**
 * A service is only ever built because `resolveServices` saw its keys, so a missing one here is a
 * bug rather than a deployment mistake — but it must still not reach a payment as an empty string.
 */
function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`${name} is needed for this deployment's services but is not set`);
  }
  return value;
}
