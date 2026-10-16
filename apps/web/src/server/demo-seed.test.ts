import { type AppDeps, appConfig, previewApproval, randomIds, silentLogger } from "@slip/app";
import { createMemoryStore } from "@slip/db/memory";
import type { AttemptId, MandateId, OwnerId } from "@slip/domain";
import { ManualClock, NOW } from "@slip/domain/testing";
import { FakeOffersSource } from "@slip/offers/fake";
import { FakePaymentGateway } from "@slip/paypal/fake";
import { FakeSteeringClassifier } from "@slip/steering/fake";
import { beforeAll, describe, expect, it } from "vitest";
import { type DemoOwner, seedDemoOwner } from "./demo-seed";
import type { Fakes } from "./runtime";

/**
 * The demo desk is built out of the real use cases, so this test is also a check that the mandate
 * flow and checkout still hang together from outside the application package.
 */
describe("seedDemoOwner", () => {
  let deps: AppDeps;
  let fakes: Fakes;
  let owner: DemoOwner;

  beforeAll(async () => {
    const clock = new ManualClock(NOW);
    fakes = {
      offers: new FakeOffersSource(),
      gateway: new FakePaymentGateway({ clock }),
      classifier: new FakeSteeringClassifier(),
    };
    deps = {
      store: createMemoryStore(),
      offers: fakes.offers,
      gateway: fakes.gateway,
      classifier: fakes.classifier,
      clock,
      ids: randomIds,
      log: silentLogger,
      config: appConfig(),
    };
    owner = await seedDemoOwner(deps, fakes);
  });

  it("leaves a mandate PayPal has approved, with a method Slip can charge", async () => {
    const mandate = await deps.store.mandates.get(owner.mandateId as MandateId);
    expect(mandate).toMatchObject({ ownerId: owner.ownerId, status: "ACTIVE", hasVaultId: true });
    const vaultId = await deps.store.mandates.vaultIdForCharge(owner.mandateId as MandateId);
    expect(vaultId).not.toBeNull();
    expect(fakes.gateway.hasVault(vaultId ?? "")).toBe(true);
    // The real flow, not a shortcut: PayPal was asked to start and then to finish the setup.
    expect(fakes.gateway.callsTo("startVaultSetup")).toHaveLength(1);
    expect(fakes.gateway.callsTo("completeVaultSetup")).toHaveLength(1);
  });

  it("issues one agent key, which works and is not stored", async () => {
    expect(owner.apiKey.startsWith("slip_live_")).toBe(true);
    const agents = await deps.store.agents.listByMandate(owner.mandateId as MandateId);
    expect(agents.map((a) => a.name)).toEqual(["shopper-1"]);
    expect(JSON.stringify(agents)).not.toContain(owner.apiKey);
  });

  it("the agent has already tried four purchases, one of each kind", async () => {
    const page = await deps.store.attempts.listByMandate(owner.mandateId as MandateId, {
      limit: 50,
    });
    const outcomes = page.items.map((r) => ({
      outcome: r.attempt.decision.outcome,
      rule: r.attempt.decision.ruleCode,
      payment: r.payment?.status ?? "NONE",
      hold: r.hold?.status ?? null,
    }));
    expect(outcomes).toHaveLength(4);
    expect(outcomes).toEqual(
      expect.arrayContaining([
        // Cheapest: paid in one step.
        { outcome: "PAID", rule: "R7_WITHIN_LIMITS", payment: "CAPTURED", hold: null },
        // $11 over and the pricier store pays more commission: refused, no PayPal order.
        { outcome: "REJECTED", rule: "R4_OVERPAID", payment: "NONE", hold: null },
        // Above the owner's cap: money reserved, waiting for them.
        { outcome: "HELD", rule: "R6_ABOVE_ORDER_CAP", payment: "AUTHORIZED", hold: "PENDING" },
        // Channel3 down: held with nothing reserved, the case approval pays in one step.
        { outcome: "HELD", rule: "R1_STALE_SNAPSHOT", payment: "NONE", hold: "PENDING" },
      ]),
    );
  });

  it("both holds can actually be decided: one captures, one pays after a re-check", async () => {
    const page = await deps.store.attempts.listByMandate(owner.mandateId as MandateId, {
      limit: 50,
    });
    const held = page.items.filter((r) => r.hold?.status === "PENDING");
    expect(held).toHaveLength(2);
    const previews = await Promise.all(
      held.map(async (r) => previewApproval(deps, owner.ownerId as OwnerId, r.attempt.id)),
    );
    expect(previews.map((p) => (p.status === "preview" ? p.kind : p.reason)).sort()).toEqual([
      // Money is reserved: approving captures it.
      "capture",
      // Nothing reserved: approving checks today's prices and pays in one step.
      "pay",
    ]);
    expect(previews.find((p) => p.status === "preview" && p.kind === "pay")).toMatchObject({
      amountCents: 31_000,
    });
  });

  it("charged once, reserved once, and left nothing else at PayPal", async () => {
    const orders = fakes.gateway.orders();
    expect(orders.filter((o) => o.intent === "CAPTURE")).toHaveLength(1);
    expect(orders.filter((o) => o.intent === "AUTHORIZE")).toHaveLength(1);
    expect(fakes.gateway.callsTo("captureAuthorization")).toEqual([]);
  });

  it("every demo desk is its own: nobody can read or revoke another's", async () => {
    const second = await seedDemoOwner(deps, fakes);
    expect(second.ownerId).not.toBe(owner.ownerId);
    expect(second.mandateId).not.toBe(owner.mandateId);
    const theirs = await deps.store.attempts.listByMandate(second.mandateId as MandateId, {
      limit: 50,
    });
    const mine = new Set(
      (
        await deps.store.attempts.listByMandate(owner.mandateId as MandateId, { limit: 50 })
      ).items.map((r) => r.attempt.id as AttemptId),
    );
    expect(theirs.items.filter((r) => mine.has(r.attempt.id))).toEqual([]);
    const otherOwner = await deps.store.mandates.get(second.mandateId as MandateId);
    expect(otherOwner?.ownerId).not.toBe(owner.ownerId as OwnerId);
  });
});
