import { randomUUID } from "node:crypto";
import { type AppConfigInput, type AppDeps, appConfig, generateApiKey, randomIds } from "@slip/app";
import { createMemoryStore } from "@slip/db/memory";
import type { PgliteTemplate } from "@slip/db/testing";
import {
  type AgentId,
  agentId,
  DEFAULT_POLICY,
  type LogFields,
  type Logger,
  type MandateId,
  mandateId,
  type Offer,
  type OwnerId,
  ownerId,
  type PolicyLimits,
  type SelectedOption,
  type Store,
} from "@slip/domain";
import { driveUntilSettled, ManualClock, NOW } from "@slip/domain/testing";
import { FakeOffersSource } from "@slip/offers/fake";
import { FakePaymentGateway } from "@slip/paypal/fake";
import { FakeSteeringClassifier } from "@slip/steering/fake";

/**
 * The whole application wired to a real store — in memory, or Postgres in-process (PGlite) — and
 * to the three fakes, on a manual clock. What the MCP server and the web app will be tested with.
 */

export type StoreKind = "memory" | "pglite";

export interface LogLine {
  level: "info" | "warn" | "error";
  event: string;
  fields: LogFields | undefined;
}

export interface World {
  kind: StoreKind;
  deps: AppDeps;
  store: Store;
  offers: FakeOffersSource;
  gateway: FakePaymentGateway;
  classifier: FakeSteeringClassifier;
  clock: ManualClock;
  logs: LogLine[];
  /** Runs `work` to completion, letting deadlines pass on the manual clock. */
  settle<T>(work: Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** A world on `kind`; a PGlite world needs the template (one per test file) to clone. */
export async function openWorld(
  kind: StoreKind,
  options: { template?: PgliteTemplate; config?: AppConfigInput } = {},
): Promise<World> {
  let store: Store;
  let close = async () => {};
  if (kind === "pglite") {
    if (options.template === undefined) {
      throw new Error("a PGlite world needs a PgliteTemplate");
    }
    const fresh = await options.template.fresh();
    store = fresh.store;
    close = fresh.close;
  } else {
    store = createMemoryStore();
  }
  const clock = new ManualClock(NOW);
  const logs: LogLine[] = [];
  const log: Logger = {
    info: (event, fields) => logs.push({ level: "info", event, fields }),
    warn: (event, fields) => logs.push({ level: "warn", event, fields }),
    error: (event, fields) => logs.push({ level: "error", event, fields }),
  };
  const offers = new FakeOffersSource();
  const gateway = new FakePaymentGateway({ clock });
  const classifier = new FakeSteeringClassifier();
  const deps: AppDeps = {
    store,
    offers,
    gateway,
    classifier,
    clock,
    ids: randomIds,
    log,
    config: appConfig(options.config),
  };
  return {
    kind,
    deps,
    store,
    offers,
    gateway,
    classifier,
    clock,
    logs,
    settle: (work) => driveUntilSettled(clock, work, { stepMs: 5_000 }),
    close,
  };
}

export interface Seeded {
  ownerId: OwnerId;
  mandateId: MandateId;
  agentId: AgentId;
  apiKey: string;
  vaultId: string;
}

/** An owner with an ACTIVE mandate (a vault the fake PayPal can charge) and one agent with a key. */
export async function seedAgent(
  world: World,
  options: { limits?: Partial<PolicyLimits> } = {},
): Promise<Seeded> {
  const now = world.clock.now();
  const owner = ownerId(randomUUID());
  const mandate = mandateId(randomUUID());
  const agent = agentId(randomUUID());
  const vaultId = `VAULT-${randomUUID()}`;
  const { version: _version, ...defaults } = DEFAULT_POLICY;
  await world.store.owners.create({ id: owner, email: null, now });
  await world.store.mandates.create({
    id: mandate,
    ownerId: owner,
    limits: { ...defaults, ...options.limits },
    now,
  });
  await world.store.mandates.activate(mandate, { vaultId, paypalCustomerId: "CUST-seed" }, now);
  world.gateway.addVault(vaultId);
  const key = generateApiKey();
  await world.store.agents.create({
    id: agent,
    mandateId: mandate,
    name: "e2e agent",
    apiKeyHash: key.hash,
    apiKeyPrefix: key.prefix,
    now,
  });
  return { ownerId: owner, mandateId: mandate, agentId: agent, apiKey: key.key, vaultId };
}

/** Lists offers for a product in the fake Channel3 catalogue. */
export function market(
  world: World,
  productId: string,
  offers: Offer[],
  options: { title?: string; selectedOptions?: SelectedOption[] } = {},
): void {
  world.offers.setProduct({
    productId,
    offers,
    ...(options.title === undefined ? {} : { title: options.title }),
    ...(options.selectedOptions === undefined ? {} : { selectedOptions: options.selectedOptions }),
  });
}
