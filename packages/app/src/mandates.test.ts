import { randomUUID } from "node:crypto";
import { type Cents, type Mandate, type OwnerId, ownerId, type PaymentGateway } from "@slip/domain";
import { driveUntilSettled, offer } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { type Harness, harness, market, seedAgent } from "./__fixtures__/harness.js";
import { runCheckout } from "./checkout/checkout.js";
import { approveHold } from "./holds.js";
import { derivedUuid } from "./keys.js";
import {
  completeMandateSetup,
  finishSetup,
  revokeMandate,
  startMandate,
  updateLimits,
} from "./mandates.js";
import { runResolver } from "./resolver.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function owner(h: Harness): Promise<OwnerId> {
  const id = ownerId(randomUUID());
  await h.store.owners.create({ id, email: null, now: h.clock.now() });
  return id;
}

/** A started setup: the mandate, its PayPal reference, and the owner. */
async function started(h: Harness) {
  const me = await owner(h);
  const result = await startMandate(h.deps, me);
  if (result.status !== "started") {
    throw new Error(`expected a started setup, got ${JSON.stringify(result)}`);
  }
  return { me, mandate: result.mandate, reference: result.mandate.setupOrderId ?? "" };
}

/** The same gateway with one method replaced. */
function replacing<K extends keyof PaymentGateway>(
  gateway: PaymentGateway,
  method: K,
  replacement: PaymentGateway[K],
): PaymentGateway {
  return new Proxy(gateway, {
    get(target, prop) {
      if (prop === method) {
        return replacement;
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

const resolve = (h: Harness) => driveUntilSettled(h.clock, runResolver(h.deps), { stepMs: 5_000 });

describe("startMandate", () => {
  it("creates a PENDING mandate with the owner's limits and returns PayPal's approval link", async () => {
    const h = harness();
    const me = await owner(h);
    const result = await startMandate(h.deps, me, { limits: { orderCapCents: 50_000 } });
    if (result.status !== "started") {
      throw new Error(JSON.stringify(result));
    }
    const { mandate } = result;
    expect(mandate).toMatchObject({ ownerId: me, status: "PENDING", hasVaultId: false });
    expect(result.approveUrl).toBe(`https://fake.paypal.test/approve/${mandate.setupOrderId}`);
    expect(await h.store.mandates.currentPolicy(mandate.id)).toMatchObject({
      version: 1,
      orderCapCents: 50_000,
      maxOverpayPctHundredths: 500,
    });
    expect(h.gateway.callsTo("startVaultSetup")[0]?.input).toMatchObject({
      mandateId: mandate.id,
      returnUrl: `http://localhost:3000/mandates/${mandate.id}/return`,
      cancelUrl: `http://localhost:3000/mandates/${mandate.id}/cancel`,
    });
  });

  it("refuses limits it cannot use, before anything is created", async () => {
    const h = harness();
    const me = await owner(h);
    expect(await startMandate(h.deps, me, { limits: { orderCapCents: -1 } })).toMatchObject({
      reason: "INVALID_LIMITS",
    });
    const unknownField = await startMandate(h.deps, me, { limits: { maxSpend: 10 } });
    expect(unknownField).toMatchObject({ reason: "INVALID_LIMITS" });
    expect(unknownField.status === "refused" && unknownField.message).toContain("maxSpend");
    expect(h.gateway.calls).toEqual([]);
  });

  it("an unknown owner is refused", async () => {
    const h = harness();
    expect(await startMandate(h.deps, ownerId(randomUUID()))).toMatchObject({
      reason: "NOT_FOUND",
    });
  });

  it("if PayPal cannot start the setup, the new mandate is given up at once", async () => {
    const h = harness();
    const deps = {
      ...h.deps,
      gateway: replacing(h.gateway, "startVaultSetup", async () => ({
        kind: "failed",
        reason: "PayPal answered 503",
      })),
    };
    const me = await owner(h);
    expect(await startMandate(deps, me)).toMatchObject({ reason: "PAYPAL_UNAVAILABLE" });
    const line = h.logs.find((l) => l.event === "mandate.setup_not_started");
    const id = line?.fields?.["mandateId"] as Mandate["id"];
    expect((await h.store.mandates.get(id))?.status).toBe("REVOKED");
  });
});

describe("completeMandateSetup", () => {
  it("the owner approved at PayPal: the mandate is ACTIVE and its saved method can be charged", async () => {
    const h = harness();
    const { me, mandate, reference } = await started(h);
    h.gateway.approveSetup(reference);
    const result = await completeMandateSetup(h.deps, me, mandate.id);
    expect(result).toMatchObject({ status: "active", mandate: { status: "ACTIVE" } });
    const vaultId = await h.store.mandates.vaultIdForCharge(mandate.id);
    expect(vaultId).not.toBeNull();
    expect(h.gateway.hasVault(vaultId ?? "")).toBe(true);
    expect(h.gateway.callsTo("completeVaultSetup")[0]?.input).toEqual({
      reference,
      requestId: derivedUuid(`slip:vault-setup:${mandate.id}`),
    });

    expect(await completeMandateSetup(h.deps, me, mandate.id)).toMatchObject({ status: "active" });
    expect(h.gateway.callsTo("completeVaultSetup")).toHaveLength(1);
  });

  it("back without approving: still PENDING", async () => {
    const h = harness();
    const { me, mandate } = await started(h);
    expect(await completeMandateSetup(h.deps, me, mandate.id)).toMatchObject({
      status: "not-approved",
      mandate: { status: "PENDING" },
    });
  });

  it("approved, but PayPal issues the saved method later: pending until a poll finds it", async () => {
    const h = harness();
    const { me, mandate, reference } = await started(h);
    h.gateway.approveSetup(reference, { deferVault: true });
    expect(await completeMandateSetup(h.deps, me, mandate.id)).toMatchObject({
      status: "pending",
    });
    h.gateway.deliverDeferredVault(reference);
    h.clock.advance(6 * MINUTE);
    expect((await resolve(h)).setups).toEqual({ settled: 1, waiting: 0, failed: 0 });
    expect((await h.store.mandates.get(mandate.id))?.status).toBe("ACTIVE");
  });

  it("another owner's mandate and a malformed id are not found", async () => {
    const h = harness();
    const { mandate } = await started(h);
    const stranger = await owner(h);
    expect(await completeMandateSetup(h.deps, stranger, mandate.id)).toMatchObject({
      reason: "NOT_FOUND",
    });
    expect(await completeMandateSetup(h.deps, stranger, "nope")).toMatchObject({
      reason: "NOT_FOUND",
    });
  });

  it("revoked while PayPal was saving the method: the method is deleted there, the mandate stays revoked", async () => {
    const h = harness();
    const { me, mandate, reference } = await started(h);
    h.gateway.approveSetup(reference);
    await h.store.mandates.revoke(mandate.id, h.clock.now());
    expect(await completeMandateSetup(h.deps, me, mandate.id)).toMatchObject({
      reason: "REVOKED",
    });

    // The same race, caught after the status was read: the late vault is not kept.
    expect(await finishSetup(h.deps, mandate)).toBe("revoked");
    const deleted = h.gateway.callsTo("deleteVaultToken")[0]?.input as { vaultId: string };
    expect(h.gateway.hasVault(deleted.vaultId)).toBe(false);
    expect(await h.store.mandates.get(mandate.id)).toMatchObject({
      status: "REVOKED",
      hasVaultId: false,
    });
  });
});

describe("the resolver's setup poll", () => {
  it("a setup under five minutes old is not polled; the owner may still be at PayPal", async () => {
    const h = harness();
    await started(h);
    h.clock.advance(4 * MINUTE);
    await resolve(h);
    expect(h.gateway.callsTo("completeVaultSetup")).toEqual([]);
  });

  it("activates a setup the owner approved without coming back, and gives up one nobody approves after three days", async () => {
    const h = harness();
    const approved = await started(h);
    const forgotten = await started(h);
    h.gateway.approveSetup(approved.reference);

    h.clock.advance(6 * MINUTE);
    expect((await resolve(h)).setups).toEqual({ settled: 1, waiting: 1, failed: 0 });
    expect((await h.store.mandates.get(approved.mandate.id))?.status).toBe("ACTIVE");

    h.clock.advance(72 * HOUR);
    expect((await resolve(h)).setups).toEqual({ settled: 1, waiting: 0, failed: 0 });
    expect((await h.store.mandates.get(forgotten.mandate.id))?.status).toBe("REVOKED");
    expect(h.logs).toContainEqual(expect.objectContaining({ event: "mandate.setup_abandoned" }));
  });

  it("an approval that lands just before the deadline is kept, not given up", async () => {
    const h = harness();
    const late = await started(h);
    h.clock.advance(72 * HOUR);
    h.gateway.approveSetup(late.reference);
    await resolve(h);
    expect((await h.store.mandates.get(late.mandate.id))?.status).toBe("ACTIVE");
  });
});

describe("revokeMandate — the kill switch", () => {
  async function withHold() {
    const h = harness();
    const seeded = await seedAgent(h);
    const chosen = offer({ price: 250 });
    market(h, "p1", [offer({ price: 249 }), chosen]);
    const held = await runCheckout(h.deps, seeded.apiKey, {
      productId: "p1",
      chosenOfferUrl: chosen.url,
      reason: "",
    });
    const id = held.status === "decided" ? held.receipt.attempt.id : "";
    return { h, seeded, id, chosen };
  }

  it("stops every charge, releases open holds and deletes the saved method at PayPal", async () => {
    const { h, seeded, id, chosen } = await withHold();
    const result = await revokeMandate(h.deps, seeded.ownerId, seeded.mandateId);
    expect(result).toMatchObject({
      status: "revoked",
      mandate: { status: "REVOKED" },
      holdsDeclined: 1,
      vault: "deleted",
    });
    expect(await h.store.holds.get(id as never)).toMatchObject({
      status: "DECLINED",
      decidedBy: seeded.ownerId,
    });
    expect((await h.store.payments.get(id as never))?.status).toBe("VOIDED");
    expect(h.gateway.hasVault(seeded.vaultId)).toBe(false);
    expect((await h.store.mandates.get(seeded.mandateId))?.vaultDeletedAt).not.toBeNull();

    expect(
      await runCheckout(h.deps, seeded.apiKey, {
        productId: "p2",
        chosenOfferUrl: chosen.url,
        reason: "",
      }),
    ).toMatchObject({ reason: "MANDATE_NOT_ACTIVE" });
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: 25_000 as Cents }),
    ).toMatchObject({ reason: "ALREADY_DECIDED" });
  });

  it("a token PayPal would not delete is left for the resolver, and revoking again is harmless", async () => {
    const { h, seeded } = await withHold();
    h.gateway.nextDelete("fail");
    expect(await revokeMandate(h.deps, seeded.ownerId, seeded.mandateId)).toMatchObject({
      vault: "failed",
    });
    expect(h.gateway.hasVault(seeded.vaultId)).toBe(true);

    expect(await revokeMandate(h.deps, seeded.ownerId, seeded.mandateId)).toMatchObject({
      status: "revoked",
      holdsDeclined: 0,
      vault: "deleted",
    });
    expect(h.gateway.hasVault(seeded.vaultId)).toBe(false);
    expect(await revokeMandate(h.deps, seeded.ownerId, seeded.mandateId)).toMatchObject({
      vault: "nothing-to-delete",
    });
  });

  it("only the owner can revoke", async () => {
    const { h, seeded } = await withHold();
    expect(await revokeMandate(h.deps, await owner(h), seeded.mandateId)).toMatchObject({
      reason: "NOT_FOUND",
    });
    expect((await h.store.mandates.get(seeded.mandateId))?.status).toBe("ACTIVE");
  });
});

describe("updateLimits", () => {
  it("adds a policy version that the next checkout is checked under", async () => {
    const h = harness();
    const seeded = await seedAgent(h);
    const updated = await updateLimits(h.deps, seeded.ownerId, seeded.mandateId, {
      orderCapCents: 30_000,
    });
    expect(updated).toMatchObject({
      status: "updated",
      policy: { version: 2, orderCapCents: 30_000 },
    });

    const chosen = offer({ price: 250 });
    market(h, "p1", [chosen, offer({ price: 249 })]);
    const result = await runCheckout(h.deps, seeded.apiKey, {
      productId: "p1",
      chosenOfferUrl: chosen.url,
      reason: "",
    });
    expect(result.status === "decided" && result.view).toMatchObject({
      outcome: "PAID",
      policyVersion: 2,
    });
  });

  it("refuses limits it cannot use, changes nothing when asked for no change, and nothing after a revoke", async () => {
    const h = harness();
    const seeded = await seedAgent(h);
    expect(
      await updateLimits(h.deps, seeded.ownerId, seeded.mandateId, { flagPctHundredths: -1 }),
    ).toMatchObject({ reason: "INVALID_LIMITS" });
    expect(await updateLimits(h.deps, seeded.ownerId, seeded.mandateId, {})).toMatchObject({
      policy: { version: 1 },
    });
    await h.store.mandates.revoke(seeded.mandateId, h.clock.now());
    expect(
      await updateLimits(h.deps, seeded.ownerId, seeded.mandateId, { orderCapCents: 1_000 }),
    ).toMatchObject({ reason: "REVOKED" });
    expect(
      await updateLimits(h.deps, await owner(h), seeded.mandateId, { orderCapCents: 1_000 }),
    ).toMatchObject({ reason: "NOT_FOUND" });
  });
});
