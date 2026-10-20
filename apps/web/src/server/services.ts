import "server-only";
import { isDemo } from "./demo";

/**
 * Which of the three outside services this deployment really talks to. Each is decided on its own,
 * because "real prices, simulated payment" is a state Slip will actually be in — a Channel3 key
 * costs nothing to hold, a PayPal sandbox needs an approved buyer — and a receipt must never call
 * a real price simulated, or a stand-in payment real (D63).
 *
 * The shared demo is the exception: it is always the stand-ins, whatever keys are set. Its
 * catalogue is per visitor by design (every desk's products have ids of their own), its approval
 * page stands in for PayPal's, and its injected listing is written for a classifier that will
 * certainly flag it. A real service would break the isolation between visitors, and spend one
 * account's credits on every passer-by. To see the real services, run without `SLIP_DEMO`.
 */

/** Where listed prices come from. */
export type PricesMode = "simulated" | "channel3";
/** Where a payment goes. `live` is the only one where real money moves. */
export type PaymentMode = "simulated" | "sandbox" | "live";
/** Who answers the steering question. */
export type SteeringMode = "simulated" | "claude";

export interface Services {
  prices: PricesMode;
  payment: PaymentMode;
  steering: SteeringMode;
}

export function resolveServices(env: NodeJS.ProcessEnv = process.env): Services {
  if (isDemo(env)) {
    return { prices: "simulated", payment: "simulated", steering: "simulated" };
  }
  return {
    prices: set(env["CHANNEL3_API_KEY"]) ? "channel3" : "simulated",
    payment: paymentMode(env),
    steering: set(env["ANTHROPIC_API_KEY"]) ? "claude" : "simulated",
  };
}

/**
 * All three PayPal values or none. The webhook id is as necessary as the credentials: without it
 * every delivery fails verification, so a deployment that had the keys but not the id would take
 * payments and then never hear what became of them.
 */
function paymentMode(env: NodeJS.ProcessEnv): PaymentMode {
  const ready =
    set(env["PAYPAL_CLIENT_ID"]) &&
    set(env["PAYPAL_CLIENT_SECRET"]) &&
    set(env["PAYPAL_WEBHOOK_ID"]);
  if (!ready) {
    return "simulated";
  }
  return env["PAYPAL_ENV"]?.trim().toLowerCase() === "live" ? "live" : "sandbox";
}

/**
 * Combinations a deployment must not run, as a sentence or null.
 *
 * Everything here hangs on one condition: `PAYPAL_ENV=live` moves real funds. Nothing is refused
 * below it — real prices with a stand-in payment is the state D63 was written for, and it moves
 * no money.
 *
 * Two of these are lies about the money. The stand-in catalogue's stores and prices are invented,
 * so a checkout would compare an agent's purchase against a made-up market and then charge a real
 * card for it; a scripted steering check is the same lie, a receipt saying the listing was checked
 * when one hard-coded phrase was matched. The sign-up page already refuses to start a *new* owner
 * under live PayPal (D65), but a key issued before the keys changed would keep working, so the
 * refusal has to be at the deployment, not at the door.
 *
 * Three are about the deployment itself, and need more than the services to see (D74):
 *
 * - **A file store.** PGlite is one process and takes no lock on its own directory, so two of
 *   them corrupt it — which is why the vault-id script refuses to run beside the server. Real
 *   money does not belong on a database that cannot be shared or backed up.
 * - **A base URL that is not https.** It is the only place Slip knows its own scheme, so PayPal
 *   is handed its hostname as the brand name on a real checkout, and the session cookie carrying
 *   the kill switch over real money is issued without `Secure`.
 * - **Nowhere for housekeeping to run.** Where an instance does not outlive its request the
 *   resolver's timer never starts, so without a cron secret nothing expires a hold or finishes an
 *   unknown payment: real authorizations would sit on real cards until PayPal dropped them.
 *
 * **Where this bites.** `build()` calls it, so the refusal lands on the first request that needs
 * the app rather than at import. That is late enough to be visible and early enough to matter:
 * nothing can reach PayPal without going through `build()`, so no money can move from a
 * deployment this refuses — but the process does start, and `/bench`, which needs none of it,
 * still renders.
 */
export function unsafeCombination(
  services: Services,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (services.payment !== "live") {
    return null;
  }
  const base = env["SLIP_BASE_URL"]?.trim() ?? "";
  const wrong = [
    services.prices === "simulated"
      ? ["prices come from the stand-in catalogue", "Set CHANNEL3_API_KEY"]
      : null,
    services.steering === "simulated"
      ? ["the steering check is the scripted stand-in", "Set ANTHROPIC_API_KEY"]
      : null,
    (env["DATABASE_URL"] ?? "").trim().startsWith("pglite://")
      ? ["the database is a single-process file store", "Point DATABASE_URL at a Postgres server"]
      : null,
    base !== "" && !base.startsWith("https://")
      ? ["SLIP_BASE_URL is not https, so the session cookie is not Secure", "Serve Slip over https"]
      : null,
    serverlessEnv(env) && !set(env["SLIP_CRON_SECRET"]) && !set(env["CRON_SECRET"])
      ? [
          "nothing would expire a hold or finish an unknown payment here",
          "Set SLIP_CRON_SECRET and schedule /api/cron/resolve",
        ]
      : null,
  ].filter((part): part is [string, string] => part !== null);
  if (wrong.length === 0) {
    return null;
  }
  const faults = wrong.map(([fault]) => fault).join("; ");
  const fixes = [...new Set(wrong.map(([, fix]) => fix))].join(". ");
  return `PAYPAL_ENV=live moves real money, but ${faults}. ${fixes}, or use the PayPal sandbox.`;
}

/** Mirrors `runtime.ts`: where an instance does not outlive its request, no timer runs. */
function serverlessEnv(env: NodeJS.ProcessEnv): boolean {
  return env["VERCEL"] !== undefined || env["SLIP_SERVERLESS"] === "1";
}

const set = (value: string | undefined): boolean => value !== undefined && value.trim() !== "";
