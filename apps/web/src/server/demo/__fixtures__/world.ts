import { type AppDeps, appConfig, randomIds, silentLogger } from "@slip/app";
import { createMemoryStore } from "@slip/db/memory";
import type { Clock } from "@slip/domain";
import { ManualClock, NOW } from "@slip/domain/testing";
import { FakeOffersSource } from "@slip/offers/fake";
import { FakePaymentGateway } from "@slip/paypal/fake";
import { FakeSteeringClassifier } from "@slip/steering/fake";
import { INJECTION_PHRASE } from "../catalogue";
import type { DemoFakes } from "../desk";
import { DemoOffers } from "../offers";
import { DemoPayPal } from "../paypal";

export interface DemoWorld {
  deps: AppDeps;
  fakes: DemoFakes & { classifier: FakeSteeringClassifier };
  inner: FakePaymentGateway;
  clock: ManualClock;
}

/** The demo's composition, on the memory store and a manual clock, as the web runtime builds it. */
export function demoWorld(options: { latencyMs?: number; clock?: Clock } = {}): DemoWorld {
  const clock = new ManualClock(NOW);
  const store = createMemoryStore();
  const inner = new FakePaymentGateway({ clock });
  const classifier = new FakeSteeringClassifier();
  classifier.flagWhenListingIncludes(INJECTION_PHRASE);
  const fakes = {
    offers: new DemoOffers(new FakeOffersSource()),
    gateway: new DemoPayPal({
      inner,
      store,
      clock: options.clock ?? clock,
      latencyMs: options.latencyMs ?? 0,
      publicBaseUrl: "http://localhost:3100",
    }),
    classifier,
  };
  const deps: AppDeps = {
    store,
    offers: fakes.offers,
    gateway: fakes.gateway,
    classifier,
    clock,
    ids: randomIds,
    log: silentLogger,
    config: appConfig({ publicBaseUrl: "http://localhost:3100", pricesSource: "simulated" }),
  };
  return { deps, fakes, inner, clock };
}
