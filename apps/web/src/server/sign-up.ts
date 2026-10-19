import "server-only";
import { type AppDeps, registerOwner, startMandate } from "@slip/app";
import type { DeskLimiter } from "./demo/desks";
import type { Services } from "./services";

/**
 * Starting as an owner outside the demo: a new owner, a permission started at PayPal, and the
 * link where the owner approves saving their payment method (D65).
 *
 * An owner may set an email and a password, which is the only way back in if the browser forgets
 * the session (D71). Where PayPal is live that is no longer optional: an owner who lost the cookie
 * would lose the kill switch over real money, which is what the blanket refusal here used to
 * prevent — so it is now refused only when no credential was set.
 *
 * It answers only on Slip's own address: a visitor arriving through the tunnel that carries PayPal's
 * webhooks to a local run cannot open owners there. Openings are rate-limited per address with the
 * demo's limiter (the demo and this path never run in one process).
 */

export type StartRefusal =
  | "LIVE"
  | "FOREIGN_HOST"
  | "FULL"
  | "SLOW"
  | "PAYPAL_UNAVAILABLE"
  | "CREDENTIAL";

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
    /** Optional, except where PayPal is live: without it there is no way back in. */
    credential?: { email: string; password: string } | undefined;
  },
): Promise<StartOwnerResult> {
  const refused = (reason: StartRefusal): StartOwnerResult => ({ status: "refused", reason });
  if (input.services.payment === "live" && input.credential === undefined) {
    return refused("LIVE");
  }
  if (input.host !== new URL(deps.config.publicBaseUrl).host) {
    return refused("FOREIGN_HOST");
  }
  const admitted = input.limiter.admit(input.address, deps.clock.now().getTime());
  if (admitted !== "ok") {
    return refused(admitted === "full" ? "FULL" : "SLOW");
  }
  const owner = await registerOwner(
    deps,
    input.credential === undefined
      ? { email: null }
      : { email: input.credential.email, password: input.credential.password },
  );
  if (owner.status !== "registered") {
    // The refusals that are the visitor's to fix — a bad address, one already used, a short
    // password — are told apart from PayPal being unavailable, so the page can say which.
    return refused(
      owner.reason === "PAYPAL_UNAVAILABLE" || owner.reason === "SETUP_FAILED"
        ? "PAYPAL_UNAVAILABLE"
        : "CREDENTIAL",
    );
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
