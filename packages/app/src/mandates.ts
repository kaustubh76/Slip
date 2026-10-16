import {
  ConflictError,
  DEFAULT_POLICY,
  InvalidIdError,
  type Mandate,
  MandateNotActiveError,
  mandateId,
  type Owner,
  type OwnerId,
  type Policy,
  type PolicyLimits,
  PolicySchema,
  requestId,
  ownerId as toOwnerId,
} from "@slip/domain";
import { z } from "zod";
import type { AppDeps } from "./deps.js";
import { closeHold } from "./holds.js";
import { derivedUuid } from "./keys.js";
import { callPayPal } from "./payments.js";
import { deleteVaultToken } from "./vault.js";

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
  | "INVALID_EMAIL"
  | "EMAIL_IN_USE"
  | "INVALID_LIMITS"
  | "INVALID_NAME"
  | "PAYPAL_UNAVAILABLE"
  | "SETUP_FAILED"
  | "REVOKED";

export interface OwnerRefusal {
  status: "refused";
  reason: OwnerRefusalReason;
  message: string;
}

export const refuseOwner = (reason: OwnerRefusalReason, message: string): OwnerRefusal => ({
  status: "refused",
  reason,
  message,
});
const refuse = refuseOwner;

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

const EmailSchema = z.email().max(254);

/**
 * A new owner. The web layer authenticates people; this only records them. The email is optional
 * (a demo owner has none), trimmed and lower-cased, and belongs to one owner only.
 */
export async function registerOwner(
  deps: AppDeps,
  input: { email: string | null },
): Promise<{ status: "registered"; owner: Owner } | OwnerRefusal> {
  const raw = input.email?.trim().toLowerCase() ?? "";
  const email = raw === "" ? null : raw;
  if (email !== null && !EmailSchema.safeParse(email).success) {
    return refuse("INVALID_EMAIL", "That does not look like an email address.");
  }
  try {
    const owner = await deps.store.owners.create({
      id: toOwnerId(deps.ids.uuid()),
      email,
      now: deps.clock.now(),
    });
    deps.log.info("owner.registered", { ownerId: owner.id });
    return { status: "registered", owner };
  } catch (error) {
    if (error instanceof ConflictError && error.code === "EMAIL_IN_USE") {
      return refuse("EMAIL_IN_USE", "An owner with this email already exists.");
    }
    throw error;
  }
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

/**
 * The kill switch. The mandate is revoked first — from that moment the store refuses every charge
 * and every approval — then each open hold is declined and its reservation released, then the
 * saved payment method is deleted at PayPal. If anything after the first step fails, the
 * resolver finishes it. Revoking again is harmless.
 */
export async function revokeMandate(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
): Promise<
  | {
      status: "revoked";
      mandate: Mandate;
      holdsDeclined: number;
      vault: "deleted" | "nothing-to-delete" | "failed";
    }
  | OwnerRefusal
> {
  const mandate = await ownedMandate(deps, ownerId, id);
  if (mandate === null) {
    return refuse("NOT_FOUND", "There is no such mandate.");
  }
  return {
    status: "revoked",
    ...(await shutDown(deps, mandate.id, ownerId, { vaultGone: false })),
  };
}

/**
 * The revoke itself, for the owner or for PayPal telling Slip the saved method is gone
 * (`vaultGone`: nothing to delete there, only the confirmation to record).
 */
export async function shutDown(
  deps: AppDeps,
  id: Mandate["id"],
  by: string,
  options: { vaultGone: boolean },
): Promise<{
  mandate: Mandate;
  holdsDeclined: number;
  vault: "deleted" | "nothing-to-delete" | "failed";
}> {
  const revoked = await deps.store.mandates.revoke(id, deps.clock.now());
  if (revoked.result === "applied") {
    deps.log.info("mandate.revoked", { mandateId: id, by });
  }
  let holdsDeclined = 0;
  for (const held of await deps.store.holds.listPending(id)) {
    const closed = await closeHold(deps, held, by);
    holdsDeclined += closed.status === "done" ? 1 : 0;
  }
  let vault: "deleted" | "nothing-to-delete" | "failed";
  if (options.vaultGone) {
    const marked = await deps.store.mandates.markVaultDeleted(id, deps.clock.now());
    vault = marked.result === "applied" ? "deleted" : "nothing-to-delete";
  } else {
    vault = await deleteVaultToken(deps, id);
  }
  return { mandate: (await deps.store.mandates.get(id)) ?? revoked.value, holdsDeclined, vault };
}

/**
 * New limits, as the next policy version; attempts already decided keep the version they were
 * checked under, and a checkout running across the change is checked again (D25).
 */
export async function updateLimits(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
  changes: unknown,
): Promise<{ status: "updated"; policy: Policy } | OwnerRefusal> {
  const mandate = await ownedMandate(deps, ownerId, id);
  if (mandate === null) {
    return refuse("NOT_FOUND", "There is no such mandate.");
  }
  const limits = parseLimits(changes);
  if ("status" in limits) {
    return limits;
  }
  if (Object.keys(limits).length === 0) {
    return { status: "updated", policy: await deps.store.mandates.currentPolicy(mandate.id) };
  }
  try {
    const policy = await deps.store.mandates.updatePolicy(mandate.id, limits, deps.clock.now());
    deps.log.info("mandate.limits_updated", { mandateId: mandate.id, version: policy.version });
    return { status: "updated", policy };
  } catch (error) {
    if (error instanceof MandateNotActiveError) {
      return refuse("REVOKED", "This mandate was revoked; its limits can no longer change.");
    }
    throw error;
  }
}
