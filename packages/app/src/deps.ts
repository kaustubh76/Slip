import type {
  Clock,
  IdSource,
  Logger,
  OffersSource,
  PaymentGateway,
  SteeringClassifier,
  Store,
} from "@slip/domain";
import type { AppConfig } from "./config.js";

/**
 * Everything a use case may touch. Nothing else: no globals, no clock or randomness of its own, so
 * every use case runs the same against the in-memory fakes and the real adapters.
 */
export interface AppDeps {
  store: Store;
  offers: OffersSource;
  gateway: PaymentGateway;
  classifier: SteeringClassifier;
  clock: Clock;
  ids: IdSource;
  log: Logger;
  config: AppConfig;
}
