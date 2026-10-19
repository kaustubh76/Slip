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
 * Only one is forbidden, and it is the one that costs someone money: **live PayPal with anything
 * else simulated.** `PAYPAL_ENV=live` moves real funds, and the stand-in catalogue's stores and
 * prices are invented — so a checkout would compare an agent's purchase against a made-up market
 * and then charge a real card for it. The sign-up page already refuses to start a *new* owner
 * under live PayPal (D65), but a key issued before the keys changed would keep working, so the
 * refusal has to be at the deployment, not at the door.
 *
 * A simulated steering check is the same kind of lie about the same money: receipts would say the
 * listing was checked when one hard-coded phrase was matched.
 *
 * Nothing else is refused. Real prices with a stand-in payment is the state D63 was written for,
 * and it moves no money.
 */
export function unsafeCombination(services: Services): string | null {
  if (services.payment !== "live") {
    return null;
  }
  const invented = [
    services.prices === "simulated" ? "prices come from the stand-in catalogue" : null,
    services.steering === "simulated" ? "the steering check is the scripted stand-in" : null,
  ].filter((part): part is string => part !== null);
  return invented.length === 0
    ? null
    : `PAYPAL_ENV=live moves real money, but ${invented.join(" and ")}.` +
        " Set CHANNEL3_API_KEY and ANTHROPIC_API_KEY, or use the PayPal sandbox.";
}

const set = (value: string | undefined): boolean => value !== undefined && value.trim() !== "";
