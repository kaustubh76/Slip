import {
  ConflictError,
  DEFAULT_POLICY,
  InvalidIdError,
  type Mandate,
  mandateId,
  type OwnerId,
  type PolicyLimits,
  PolicySchema,
  requestId,
} from "@slip/domain";
import type { z } from "zod";
import type { AppDeps } from "./deps.js";
import { derivedUuid } from "./keys.js";
import { callPayPal } from "./payments.js";

/**
 * The owner's mandate: their one-time consent, given at PayPal, for Slip to charge a saved
 * payment method within their limits. Every call here is scoped to the owner the web layer has
 * authenticated; another owner's mandate is "not found".
 *
 * Setup: Slip asks PayPal for a setup link and sends the owner there. When they come back (or,
 * if they never do, when the resolver polls), Slip asks PayPal for the saved method; once it has
 * the vault id the mandate is ACTIVE. A setup nobody approves is given up after three days.
 */

export type OwnerRefusalReason =
  | "NOT_FOUND"
  | "INVALID_LIMITS"
  | "PAYPAL_UNAVAILABLE"
  | "SETUP_FAILED"
  | "REVOKED";

export interface OwnerRefusal {
  status: "refused";
  reason: OwnerRefusalReason;
  message: string;
}

const refuse = (reason: OwnerRefusalReason, message: string): OwnerRefusal => ({
  status: "refused",
  reason,
  message,
});

/** Limits an owner may set; anything left out keeps its default (or its current value). */
export const PolicyLimitsInputSchema = PolicySchema.omit({ version: true }).partial().strict();
export type PolicyLimitsInput = z.input<typeof PolicyLimitsInputSchema>;

/** Validated limits, or the refusal that explains what is wrong with them. */
export function parseLimits(input: unknown): Partial<PolicyLimits> | OwnerRefusal {
  const parsed = PolicyLimitsInputSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "limits"}: ${issue.message}`)
      .join("; ");
    return refuse("INVALID_LIMITS", `These limits cannot be used (${detail}).`);
  }
  // Fields left out stay out, rather than being set to undefined.
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, value]) => value !== undefined),
  ) as Partial<PolicyLimits>;
}

/** The owner's mandate, or null — for an unknown id, a malformed one, or someone else's. */
export async function ownedMandate(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
): Promise<Mandate | null> {
  let mandate: Mandate | null;
  try {
    mandate = await deps.store.mandates.get(mandateId(id));
  } catch (error) {
    if (error instanceof InvalidIdError) {
      return null;
    }
    throw error;
  }
  return mandate?.ownerId === ownerId ? mandate : null;
}

/** Where PayPal sends the owner back, under the public base URL. */
function returnUrl(deps: AppDeps, path: string): string {
  const base = deps.config.publicBaseUrl;
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString();
}

/**
 * A PENDING mandate with the owner's limits, and the PayPal link where they approve saving a
 * payment method. If PayPal cannot start the setup, the new mandate is given up at once, so no
 * half-made mandate is left behind; the owner just tries again.
 */
export async function startMandate(
  deps: AppDeps,
  ownerId: OwnerId,
  input: { limits?: unknown } = {},
): Promise<{ status: "started"; mandate: Mandate; approveUrl: string } | OwnerRefusal> {
  if ((await deps.store.owners.get(ownerId)) === null) {
    return refuse("NOT_FOUND", "There is no such owner.");
  }
  const limits = parseLimits(input.limits);
  if ("status" in limits) {
    return limits;
  }
  const { version: _version, ...defaults } = DEFAULT_POLICY;
  const id = mandateId(deps.ids.uuid());
  await deps.store.mandates.create({
    id,
    ownerId,
    limits: { ...defaults, ...limits },
    now: deps.clock.now(),
  });

  const started = await callPayPal(deps, "vault setup start", (signal) =>
    deps.gateway.startVaultSetup(
      {
        mandateId: id,
        requestId: requestId(deps.ids.uuid()),
        returnUrl: returnUrl(deps, `mandates/${id}/return`),
        cancelUrl: returnUrl(deps, `mandates/${id}/cancel`),
      },
      signal,
    ),
  );
  if (started.kind !== "started") {
    await deps.store.mandates.revoke(id, deps.clock.now());
    deps.log.warn("mandate.setup_not_started", { mandateId: id, reason: started.reason });
    return refuse("PAYPAL_UNAVAILABLE", "PayPal could not start the setup. Try again shortly.");
  }
  const mandate = await deps.store.mandates.attachSetupOrder(
    id,
    started.reference,
    deps.clock.now(),
  );
  deps.log.info("mandate.setup_started", { mandateId: id });
  return { status: "started", mandate, approveUrl: started.approveUrl };
}

export type SetupState = "active" | "pending" | "not-approved" | "failed" | "revoked";

/**
 * The owner is back from PayPal: ask for the saved payment method. `pending` means PayPal
 * approved it but has not issued the vault id yet; it arrives by webhook or a later poll.
 */
export async function completeMandateSetup(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
): Promise<{ status: SetupState; mandate: Mandate } | OwnerRefusal> {
  const mandate = await ownedMandate(deps, ownerId, id);
  if (mandate === null || (mandate.status === "PENDING" && mandate.setupOrderId === null)) {
    return refuse("NOT_FOUND", "There is no such mandate setup.");
  }
  if (mandate.status === "REVOKED") {
    return refuse("REVOKED", "This mandate was revoked. Start a new one.");
  }
  const status = mandate.status === "ACTIVE" ? "active" : await finishSetup(deps, mandate);
  if (status === "failed") {
    return refuse("SETUP_FAILED", "PayPal could not confirm the saved payment method. Try again.");
  }
  return { status, mandate: (await deps.store.mandates.get(mandate.id)) ?? mandate };
}

/**
 * Asks PayPal for the payment method saved by a PENDING mandate's setup, with a request id
 * derived from the mandate, so the owner's return and the resolver's poll are one request.
 */
export async function finishSetup(deps: AppDeps, mandate: Mandate): Promise<SetupState> {
  const reference = mandate.setupOrderId;
  if (reference === null) {
    return "not-approved";
  }
  const result = await callPayPal(deps, "vault setup completion", (signal) =>
    deps.gateway.completeVaultSetup(
      { reference, requestId: requestId(derivedUuid(`slip:vault-setup:${mandate.id}`)) },
      signal,
    ),
  );
  switch (result.kind) {
    case "vaulted":
      return activateMandate(deps, mandate.id, {
        vaultId: result.vaultId,
        customerId: result.customerId,
      });
    case "pending":
      return "pending";
    case "not-approved":
      return "not-approved";
    case "failed":
    case "unknown":
      deps.log.warn("mandate.setup_unconfirmed", { mandateId: mandate.id, reason: result.reason });
      return "failed";
  }
}

/**
 * Records the vaulted payment method; the mandate becomes ACTIVE. If the owner revoked while
 * PayPal was still saving it, the method belongs to nothing: it is deleted at PayPal (best
 * effort, logged) and the mandate stays revoked.
 */
export async function activateMandate(
  deps: AppDeps,
  id: Mandate["id"],
  vault: { vaultId: string; customerId: string | null },
): Promise<"active" | "revoked"> {
  let activated: Awaited<ReturnType<AppDeps["store"]["mandates"]["activate"]>>;
  try {
    activated = await deps.store.mandates.activate(
      id,
      { vaultId: vault.vaultId, paypalCustomerId: vault.customerId },
      deps.clock.now(),
    );
  } catch (error) {
    if (error instanceof ConflictError && error.code === "MANDATE_VAULT_SET") {
      // Already active with another saved method: keep it, and leave this one for a human.
      deps.log.error("mandate.second_vault", { mandateId: id });
      return "active";
    }
    throw error;
  }
  if (activated.result !== "stale") {
    if (activated.result === "applied") {
      deps.log.info("mandate.activated", { mandateId: id });
    }
    return "active";
  }
  const deleted = await callPayPal(deps, "vault token deletion", (signal) =>
    deps.gateway.deleteVaultToken(vault.vaultId, signal),
  );
  const log = deleted.kind === "deleted" || deleted.kind === "already-gone" ? "info" : "warn";
  deps.log[log]("mandate.vault_after_revoke", { mandateId: id, paypal: deleted.kind });
  return "revoked";
}

/**
 * The resolver's poll of one PENDING setup, asked about like the owner's return. Once it is older
 * than `setupAbandonAfterMs` and PayPal still has nothing approved, it is given up (revoked).
 */
export async function pollSetup(deps: AppDeps, mandate: Mandate): Promise<SetupState> {
  const state = await finishSetup(deps, mandate);
  const age = deps.clock.now().getTime() - mandate.createdAt.getTime();
  if ((state === "not-approved" || state === "failed") && age >= deps.config.setupAbandonAfterMs) {
    await deps.store.mandates.revoke(mandate.id, deps.clock.now());
    deps.log.info("mandate.setup_abandoned", { mandateId: mandate.id });
    return "revoked";
  }
  return state;
}
