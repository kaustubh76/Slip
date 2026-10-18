import "server-only";
import {
  type AppDeps,
  appConfig,
  jsonLogger,
  randomIds,
  runResolver,
  silentLogger,
  systemClock,
} from "@slip/app";
import { createPgStore, openDatabase, VaultCipher } from "@slip/db";
import { createMemoryStore } from "@slip/db/memory";
import type { OffersSource, PaymentGateway, SteeringClassifier, Store } from "@slip/domain";
import { createChannel3Offers } from "@slip/offers";
import { FakeOffersSource } from "@slip/offers/fake";
import { createPayPalGateway, PAYPAL_LIVE_BASE_URL, PAYPAL_SANDBOX_BASE_URL } from "@slip/paypal";
import { FakePaymentGateway } from "@slip/paypal/fake";
import { createClaudeSteeringClassifier } from "@slip/steering";
import { FakeSteeringClassifier } from "@slip/steering/fake";
import { isDemo } from "./demo";
import { INJECTION_PHRASE } from "./demo/catalogue";
import type { DemoFakes } from "./demo/desk";
import { type DemoDesk, DeskLimiter } from "./demo/desks";
import { DemoOffers } from "./demo/offers";
import { DemoPayPal } from "./demo/paypal";
import { DEMO_TIMING, demoConfig, demoLatencyMs, every } from "./demo/timing";
import { resolveServices, type Services } from "./services";

/**
 * Where the application is assembled: one `AppDeps` per server process, built once and reused by
 * every request, because it owns a database pool. Next.js reloads modules in development, so the
 * instance hangs off `globalThis` rather than a module variable.
 *
 * Each of Channel3, PayPal and the steering classifier is the real adapter when its keys are set
 * and the in-memory stand-in otherwise, service by service (`./services`, D63). The stand-ins are
 * wrapped so many visitors can share one process: outcomes, outages and call logs are kept per desk
 * (`DemoPayPal`, `DemoOffers`). That is why `fakes` is exposed: the demo seed and console stock a
 * catalogue and approve a PayPal setup, which only a fake can do — and which is why the shared demo
 * always runs on the stand-ins.
 */

/** What this process really talks to. Read at import time, so a page can say so without awaiting. */
export const SERVICES: Services = resolveServices(process.env);

export interface Fakes extends DemoFakes {
  classifier: FakeSteeringClassifier;
}

export interface Runtime {
  deps: AppDeps;
  /** Null when any service here is the real one: there is then nothing to stand in for. */
  fakes: Fakes | null;
  /** Demo desks opened by this process, by mandate, and the limits on opening more. */
  demo: { desks: Map<string, DemoDesk>; limiter: DeskLimiter };
}

const KEY = Symbol.for("slip.web.runtime");
const holder = globalThis as typeof globalThis & { [KEY]?: Promise<Runtime> };

export function runtime(): Promise<Runtime> {
  holder[KEY] ??= build();
  return holder[KEY];
}

export async function deps(): Promise<AppDeps> {
  return (await runtime()).deps;
}

/**
 * The stand-ins, for the demo's own seeding and console. Throws where a real service is wired in:
 * a caller asking to approve a PayPal setup by hand has no business doing so against PayPal.
 */
export async function fakes(): Promise<Fakes> {
  const held = (await runtime()).fakes;
  if (held === null) {
    throw new Error("this deployment uses the real services; there are no stand-ins to drive");
  }
  return held;
}

async function build(): Promise<Runtime> {
  const env = process.env;
  const clock = systemClock;
  const demo = isDemo(env);
  const store = await openStore(env);
  const config = appConfig({
    ...(demo ? demoConfig() : {}),
    ...(env["SLIP_BASE_URL"] ? { publicBaseUrl: env["SLIP_BASE_URL"] } : {}),
    pricesSource: SERVICES.prices === "channel3" ? "channel3" : "simulated",
  });
  const everythingSimulated =
    SERVICES.prices === "simulated" &&
    SERVICES.payment === "simulated" &&
    SERVICES.steering === "simulated";
  const fakes: Fakes | null = everythingSimulated
    ? standIns({ store, clock, demo, env, publicBaseUrl: config.publicBaseUrl })
    : null;
  const deps: AppDeps = {
    store,
    offers: fakes?.offers ?? realOffers(env),
    gateway: fakes?.gateway ?? realGateway(env, config.publicBaseUrl),
    classifier: fakes?.classifier ?? realClassifier(env),
    clock,
    ids: randomIds,
    log: env["NODE_ENV"] === "test" ? silentLogger : jsonLogger,
    config,
  };
  const limiter = new DeskLimiter({
    maxDesks: positiveInt(env["SLIP_DEMO_MAX_DESKS"], 500),
    perAddress: positiveInt(env["SLIP_DEMO_DESKS_PER_ADDRESS"], 10),
    windowMs: 10 * 60_000,
  });
  if (demo && env["NODE_ENV"] !== "test") {
    // A demo has no scheduler, so it finishes its own loose ends: unknown payments, holds left by a
    // revoke, expiries, setups to poll. Started here, inside the one runtime every server bundle
    // shares, so it runs once per process whichever bundle builds the runtime first.
    every(
      DEMO_TIMING.resolverEveryMs,
      () => runResolver(deps),
      (error) => deps.log.error("demo.resolver_failed", { error: String(error) }),
    );
  }
  return { deps, fakes, demo: { desks: new Map(), limiter } };
}

/**
 * The stand-ins, built only where every service is one. A deployment with some real and some
 * simulated keeps no stand-in at all: the demo machinery those objects exist for (per-desk
 * catalogues, a hand-driven PayPal approval) is only coherent when the whole set is simulated.
 */
function standIns(input: {
  store: Store;
  clock: AppDeps["clock"];
  demo: boolean;
  env: NodeJS.ProcessEnv;
  publicBaseUrl: string;
}): Fakes {
  const classifier = new FakeSteeringClassifier();
  // The demo's steered listing carries this note; the stand-in classifier calls it instruction-like.
  classifier.flagWhenListingIncludes(INJECTION_PHRASE);
  return {
    offers: new DemoOffers(new FakeOffersSource()),
    gateway: new DemoPayPal({
      inner: new FakePaymentGateway({ clock: input.clock }),
      store: input.store,
      clock: input.clock,
      latencyMs: input.demo ? demoLatencyMs(input.env["SLIP_DEMO_LATENCY_MS"]) : 0,
      publicBaseUrl: input.publicBaseUrl,
    }),
    classifier,
  };
}

function realOffers(env: NodeJS.ProcessEnv): OffersSource {
  return createChannel3Offers({ apiKey: required(env, "CHANNEL3_API_KEY") });
}

function realGateway(env: NodeJS.ProcessEnv, publicBaseUrl: string): PaymentGateway {
  return createPayPalGateway({
    clientId: required(env, "PAYPAL_CLIENT_ID"),
    clientSecret: required(env, "PAYPAL_CLIENT_SECRET"),
    webhookId: required(env, "PAYPAL_WEBHOOK_ID"),
    baseUrl: SERVICES.payment === "live" ? PAYPAL_LIVE_BASE_URL : PAYPAL_SANDBOX_BASE_URL,
    brandName: new URL(publicBaseUrl).hostname,
  });
}

function realClassifier(env: NodeJS.ProcessEnv): SteeringClassifier {
  return createClaudeSteeringClassifier({ apiKey: required(env, "ANTHROPIC_API_KEY") });
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

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * `DATABASE_URL` decides: Postgres or PGlite through `@slip/db`, migrated on the way up. A demo
 * with no URL at all runs on the in-memory store, so the app starts with nothing installed.
 */
async function openStore(env: NodeJS.ProcessEnv): Promise<Store> {
  const url = env["DATABASE_URL"]?.trim();
  if (url === undefined || url === "") {
    if (!isDemo(env)) {
      throw new Error("DATABASE_URL is not set");
    }
    return createMemoryStore();
  }
  const handle = await openDatabase(url);
  if (handle.kind === "pglite") {
    // A PGlite database is this process's own (in memory, or a directory beside the app), so it
    // migrates itself on the way up. A Postgres deployment is migrated by `pnpm db:migrate`
    // before the app starts: a web server that migrates on boot would race its own replicas.
    await handle.migrate();
  }
  return createPgStore(handle.db, cipherFor(env));
}

/**
 * A demo may run without `SLIP_ENCRYPTION_KEY`: its vault ids are then encrypted under a key that
 * lasts as long as the process, so a restart cannot read them back — which is what a throwaway
 * sandbox wants. Anywhere else the key is required.
 */
function cipherFor(env: NodeJS.ProcessEnv): VaultCipher {
  const key = env["SLIP_ENCRYPTION_KEY"]?.trim();
  return (key === undefined || key === "") && isDemo(env)
    ? VaultCipher.random()
    : VaultCipher.fromEnv(env);
}
