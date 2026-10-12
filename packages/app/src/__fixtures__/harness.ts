import { createMemoryStore } from "@slip/db/memory";
import type { LogFields, Logger, Store } from "@slip/domain";
import { ManualClock, NOW } from "@slip/domain/testing";
import { FakeOffersSource } from "@slip/offers/fake";
import { FakePaymentGateway } from "@slip/paypal/fake";
import { FakeSteeringClassifier } from "@slip/steering/fake";
import { type AppConfigInput, appConfig } from "../config.js";
import type { AppDeps } from "../deps.js";
import { randomIds } from "../runtime.js";

export interface LogLine {
  level: "info" | "warn" | "error";
  event: string;
  fields: LogFields | undefined;
}

export interface Harness {
  deps: AppDeps;
  store: Store;
  offers: FakeOffersSource;
  gateway: FakePaymentGateway;
  classifier: FakeSteeringClassifier;
  clock: ManualClock;
  logs: LogLine[];
}

/**
 * The application wired to the in-memory store (or a given one, e.g. PGlite), the three fakes, a
 * manual clock starting at `NOW`, and a logger that records every line for assertions.
 */
export function harness(options: { store?: Store; config?: AppConfigInput } = {}): Harness {
  const clock = new ManualClock(NOW);
  const logs: LogLine[] = [];
  const log: Logger = {
    info: (event, fields) => logs.push({ level: "info", event, fields }),
    warn: (event, fields) => logs.push({ level: "warn", event, fields }),
    error: (event, fields) => logs.push({ level: "error", event, fields }),
  };
  const store = options.store ?? createMemoryStore();
  const offers = new FakeOffersSource();
  const gateway = new FakePaymentGateway({ clock });
  const classifier = new FakeSteeringClassifier();
  return {
    deps: {
      store,
      offers,
      gateway,
      classifier,
      clock,
      ids: randomIds,
      log,
      config: appConfig(options.config),
    },
    store,
    offers,
    gateway,
    classifier,
    clock,
    logs,
  };
}
