import "server-only";
import {
  type AppDeps,
  appConfig,
  jsonLogger,
  randomIds,
  silentLogger,
  systemClock,
} from "@slip/app";
import { createPgStore, openDatabase, VaultCipher } from "@slip/db";
import { createMemoryStore } from "@slip/db/memory";
import type { Store } from "@slip/domain";
import { FakeOffersSource } from "@slip/offers/fake";
import { FakePaymentGateway } from "@slip/paypal/fake";
import { FakeSteeringClassifier } from "@slip/steering/fake";
import { isDemo } from "./demo";
import { INJECTION_PHRASE } from "./demo/catalogue";
import type { DemoFakes } from "./demo/desk";
import { type DemoDesk, DeskLimiter } from "./demo/desks";
import { DemoOffers } from "./demo/offers";
import { DemoPayPal } from "./demo/paypal";

/**
 * Where the application is assembled: one `AppDeps` per server process, built once and reused by
 * every request, because it owns a database pool. Next.js reloads modules in development, so the
 * instance hangs off `globalThis` rather than a module variable.
 *
 * Channel3, PayPal and the steering classifier are still the in-memory fakes (Increments 1, 3 and
 * 5 bring the real adapters), wrapped so many visitors can share one process: outcomes, outages and
 * call logs are kept per desk (`DemoPayPal`, `DemoOffers`). That is why `fakes` is exposed: the
 * demo seed and console stock a catalogue and approve a PayPal setup, which only a fake can do.
 */

/**
 * True while Channel3 and PayPal are the in-memory stand-ins. Receipts and the disclosure line say
 * so; it becomes false when the real adapters are wired in here.
 */
export const SIMULATED_SERVICES = true;

export interface Fakes extends DemoFakes {
  classifier: FakeSteeringClassifier;
}

export interface Runtime {
  deps: AppDeps;
  fakes: Fakes;
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

export async function fakes(): Promise<Fakes> {
  return (await runtime()).fakes;
}

async function build(): Promise<Runtime> {
  const env = process.env;
  const clock = systemClock;
  const store = await openStore(env);
  const config = appConfig({
    ...(env["SLIP_BASE_URL"] ? { publicBaseUrl: env["SLIP_BASE_URL"] } : {}),
    pricesSource: SIMULATED_SERVICES ? "simulated" : "channel3",
  });
  const classifier = new FakeSteeringClassifier();
  // The demo's steered listing carries this note; the stand-in classifier calls it instruction-like.
  classifier.flagWhenListingIncludes(INJECTION_PHRASE);
  const fakes: Fakes = {
    offers: new DemoOffers(new FakeOffersSource()),
    gateway: new DemoPayPal({
      inner: new FakePaymentGateway({ clock }),
      store,
      clock,
      latencyMs: 0,
      publicBaseUrl: config.publicBaseUrl,
    }),
    classifier,
  };
  const deps: AppDeps = {
    store,
    offers: fakes.offers,
    gateway: fakes.gateway,
    classifier: fakes.classifier,
    clock,
    ids: randomIds,
    log: env["NODE_ENV"] === "test" ? silentLogger : jsonLogger,
    config,
  };
  const limiter = new DeskLimiter({
    maxDesks: positiveInt(env["SLIP_DEMO_MAX_DESKS"], 500),
    perAddress: 10,
    windowMs: 10 * 60_000,
  });
  return { deps, fakes, demo: { desks: new Map(), limiter } };
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
