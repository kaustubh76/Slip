import "server-only";
import { type AppDeps, registerOwner, startMandate } from "@slip/app";
import type { DeskLimiter } from "./demo/desks";
import type { Services } from "./services";

/**
 * Starting as an owner outside the demo: a new owner, a permission started at PayPal, and the
 * link where the owner approves saving their payment method (D65). Their browser then carries the
 * session; there is no returning-owner sign-in yet, which is why it is refused where PayPal is live —
 * an owner who lost the cookie would lose the kill switch over real money.
 *
 * It answers only on Slip's own address: a visitor arriving through the tunnel that carries PayPal's
 * webhooks to a local run cannot open owners there. Openings are rate-limited per address with the
 * demo's limiter (the demo and this path never run in one process).
 */

export type StartRefusal = "LIVE" | "FOREIGN_HOST" | "FULL" | "SLOW" | "PAYPAL_UNAVAILABLE";

export type StartOwnerResult =
  | { status: "started"; ownerId: string; mandateId: string; approveUrl: string }
  | { status: "refused"; reason: StartRefusal };

export async function startOwner(
  deps: AppDeps,
  input: {
    services: Services;
    /** The host the request arrived for (`x-forwarded-host`, else `host`). */
    host: string | null;
    address: string;
    limiter: DeskLimiter;
  },
): Promise<StartOwnerResult> {
  const refused = (reason: StartRefusal): StartOwnerResult => ({ status: "refused", reason });
  if (input.services.payment === "live") {
    return refused("LIVE");
  }
  if (input.host !== new URL(deps.config.publicBaseUrl).host) {
    return refused("FOREIGN_HOST");
  }
  const admitted = input.limiter.admit(input.address, deps.clock.now().getTime());
  if (admitted !== "ok") {
    return refused(admitted === "full" ? "FULL" : "SLOW");
  }
  const owner = await registerOwner(deps, { email: null });
  if (owner.status !== "registered") {
    return refused("PAYPAL_UNAVAILABLE");
  }
  const started = await startMandate(deps, owner.owner.id, {});
  if (started.status !== "started") {
    return refused("PAYPAL_UNAVAILABLE");
  }
  return {
    status: "started",
    ownerId: owner.owner.id,
    mandateId: started.mandate.id,
    approveUrl: started.approveUrl,
  };
}
