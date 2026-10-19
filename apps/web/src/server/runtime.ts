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
import type { Store } from "@slip/domain";
import type { FakeSteeringClassifier } from "@slip/steering/fake";
import { assembleServices, type StandIns } from "./assembly";
import { isDemo } from "./demo";
import type { DemoFakes } from "./demo/desk";
import { type DemoDesk, DeskLimiter } from "./demo/desks";
import { DEMO_TIMING, demoConfig, every } from "./demo/timing";
import { resolveServices, type Services } from "./services";

/**
 * Where the application is assembled: one `AppDeps` per server process, built once and reused by
 * every request, because it owns a database pool. Next.js reloads modules in development, so the
 * instance hangs off `globalThis` rather than a module variable.
 *
 * Each of Channel3, PayPal and the steering classifier is the real adapter when its keys are set
 * and the in-memory stand-in otherwise, service by service (`./assembly`, D63, D64). The stand-ins
 * are wrapped so many visitors can share one process: outcomes, outages and call logs are kept per
 * desk (`DemoPayPal`, `DemoOffers`). `standIns` exposes each one for the simulated PayPal page;
 * `fakes` exposes the whole set, which the demo seed and console need — and which is why the shared
 * demo always runs on the stand-ins.
 */

/** What this process really talks to. Read at import time, so a page can say so without awaiting. */
export const SERVICES: Services = resolveServices(process.env);

export interface Fakes extends DemoFakes {
  classifier: FakeSteeringClassifier;
}

export interface Runtime {
  deps: AppDeps;
  /** The stand-in behind each simulated service; null where the service is real. */
  standIns: StandIns;
  /** All three stand-ins, or null when any service here is the real one. */
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
  const services = assembleServices({
    services: SERVICES,
    env,
    store,
    clock,
    demo,
    publicBaseUrl: config.publicBaseUrl,
  });
  const { standIns } = services;
  const fakes: Fakes | null =
    standIns.offers !== null && standIns.gateway !== null && standIns.classifier !== null
      ? { offers: standIns.offers, gateway: standIns.gateway, classifier: standIns.classifier }
      : null;
  const deps: AppDeps = {
    store,
    offers: services.offers,
    gateway: services.gateway,
    classifier: services.classifier,
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
  return { deps, standIns, fakes, demo: { desks: new Map(), limiter } };
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
