import { randomUUID } from "node:crypto";
import { createMemoryStore } from "@slip/db/memory";
import {
  type AgentId,
  agentId,
  DEFAULT_POLICY,
  type LogFields,
  type Logger,
  type MandateId,
  mandateId,
  type OwnerId,
  ownerId,
  type PolicyLimits,
  type Store,
} from "@slip/domain";
import { ManualClock, NOW } from "@slip/domain/testing";
import { FakeOffersSource } from "@slip/offers/fake";
import { FakePaymentGateway } from "@slip/paypal/fake";
import { FakeSteeringClassifier } from "@slip/steering/fake";
import { type AppConfigInput, appConfig } from "../config.js";
import type { AppDeps } from "../deps.js";
import { generateApiKey } from "../keys.js";
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

export interface Seeded {
  ownerId: OwnerId;
  mandateId: MandateId;
  agentId: AgentId;
  apiKey: string;
  vaultId: string;
}

/**
 * An owner, a mandate (ACTIVE unless asked otherwise, with a vault the fake PayPal can charge) and
 * an agent with a real API key — the state the mandate flow leaves behind.
 */
export async function seedAgent(
  h: Harness,
  options: { activate?: boolean; limits?: Partial<PolicyLimits> } = {},
): Promise<Seeded> {
  const now = h.clock.now();
  const owner = ownerId(randomUUID());
  const mandate = mandateId(randomUUID());
  const agent = agentId(randomUUID());
  const vaultId = `VAULT-${randomUUID()}`;
  const { version: _version, ...defaults } = DEFAULT_POLICY;
  await h.store.owners.create({ id: owner, email: null, now });
  await h.store.mandates.create({
    id: mandate,
    ownerId: owner,
    limits: { ...defaults, ...options.limits },
    now,
  });
  if (options.activate !== false) {
    await h.store.mandates.activate(mandate, { vaultId, paypalCustomerId: "CUST-seed" }, now);
    h.gateway.addVault(vaultId);
  }
  const key = generateApiKey();
  await h.store.agents.create({
    id: agent,
    mandateId: mandate,
    name: "test agent",
    apiKeyHash: key.hash,
    apiKeyPrefix: key.prefix,
    now,
  });
  return { ownerId: owner, mandateId: mandate, agentId: agent, apiKey: key.key, vaultId };
}
