import { randomUUID } from "node:crypto";
import { createMemoryStore } from "@slip/db/memory";
import { type AttemptId, type Cents, type GatewayEvent, ownerId, type Store } from "@slip/domain";
import { driveUntilSettled, offer } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { type Harness, harness, market, type Seeded, seedAgent } from "./__fixtures__/harness.js";
import { runCheckout } from "./checkout/checkout.js";
import { approveHold, declineHold } from "./holds.js";
import { startMandate } from "./mandates.js";
import { runResolver } from "./resolver.js";
import { receiveWebhook } from "./webhooks.js";

const MINUTE = 60_000;
let product = 0;

async function buy(h: Harness, seeded: Seeded, kind: "paid" | "held"): Promise<AttemptId> {
  product += 1;
  const productId = `product-${product}`;
  const chosen = offer({ price: kind === "paid" ? 10 : 250 });
  market(h, productId, [chosen, offer({ price: kind === "paid" ? 11 : 249 })]);
  const result = await driveUntilSettled(
    h.clock,
    runCheckout(h.deps, seeded.apiKey, { productId, chosenOfferUrl: chosen.url, reason: "" }),
    { stepMs: 5_000 },
  );
  if (result.status !== "decided") {
    throw new Error(JSON.stringify(result));
  }
  return result.receipt.attempt.id;
}

async function setup(options: { store?: Store } = {}) {
  const h = harness(options);
  const seeded = await seedAgent(h);
  const deliver = (event: GatewayEvent, options: { id?: string; signed?: boolean } = {}) =>
    receiveWebhook(h.deps, h.gateway.webhook(event, options).request);
  return { h, seeded, deliver };
}

const paymentOf = async (h: Harness, id: AttemptId) => h.store.payments.get(id);

describe("receiving a webhook", () => {
  it("a verified event settles the payment once; a redelivery is a duplicate", async () => {
    const { h, seeded, deliver } = await setup();
    h.gateway.nextOrder("timeout-before-commit");
    const id = await buy(h, seeded, "paid");
    const event: GatewayEvent = {
      kind: "capture-completed",
      attemptId: id,
      orderId: "ORDER-77",
      captureId: "CAP-77",
    };
    expect(await deliver(event, { id: "WH-1" })).toEqual({ status: "processed", eventId: "WH-1" });
    expect(await paymentOf(h, id)).toMatchObject({
      status: "CAPTURED",
      paypalOrderId: "ORDER-77",
      captureId: "CAP-77",
    });
    const events = (await h.store.payments.events(id)).length;
    expect(await deliver(event, { id: "WH-1" })).toEqual({ status: "duplicate", eventId: "WH-1" });
    expect(await h.store.payments.events(id)).toHaveLength(events);
  });

  it("a forged delivery is rejected and nothing is stored", async () => {
    const { h, seeded, deliver } = await setup();
    const id = await buy(h, seeded, "paid");
    const forged = await deliver(
      { kind: "capture-declined", attemptId: id, captureId: null, reason: "X" },
      { signed: false },
    );
    expect(forged).toEqual({ status: "rejected", reason: "BAD_SIGNATURE" });
    expect(await h.store.webhooks.listUnprocessed(10)).toEqual([]);
    expect((await paymentOf(h, id))?.status).toBe("CAPTURED");
  });

  it("a body that is not a PayPal event is rejected", async () => {
    const { h } = await setup();
    const headers = { "paypal-transmission-sig": "fake-valid" };
    expect(await receiveWebhook(h.deps, { headers, rawBody: "{not json" })).toEqual({
      status: "rejected",
      reason: "MALFORMED",
    });
    expect(
      await receiveWebhook(h.deps, { headers, rawBody: JSON.stringify({ event_type: "X" }) }),
    ).toEqual({ status: "rejected", reason: "MALFORMED" });
  });

  it("when PayPal cannot verify the signature in time, PayPal is asked to retry", async () => {
    const { h, deliver } = await setup();
    const deps = {
      ...h.deps,
      gateway: new Proxy(h.gateway, {
        get(target, prop) {
          if (prop === "verifyWebhook") {
            return () => new Promise(() => {});
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
    const delivery = h.gateway.webhook({ kind: "ignored", eventType: "X" }).request;
    expect(
      await driveUntilSettled(h.clock, receiveWebhook(deps, delivery), { stepMs: 5_000 }),
    ).toMatchObject({ status: "retry" });
    expect(await deliver({ kind: "ignored", eventType: "X" })).toMatchObject({
      status: "processed",
    });
  });

  it("an event whose custom id was lost is still matched, by the order it names", async () => {
    // PayPal is not the only thing that writes `custom_id`, and an event can arrive without one.
    // The order id is the other way back to the payment, and it is no more trusted than the first:
    // both end at a row Slip wrote, or at nothing (D74). Built with the stores, wired by nothing,
    // until this test.
    const { h, seeded, deliver } = await setup();
    const id = await buy(h, seeded, "paid");
    const orderId = (await paymentOf(h, id))?.paypalOrderId ?? null;
    expect(orderId).not.toBeNull();
    expect(
      await deliver({
        kind: "capture-pending",
        attemptId: "",
        orderId,
        captureId: "C-LATE",
      }),
    ).toMatchObject({ status: "processed" });
    expect(h.logs.filter((l) => l.event === "webhook.unknown_payment")).toHaveLength(0);
  });

  it("an event about a payment Slip never made is processed and logged, not retried", async () => {
    const { h, deliver } = await setup();
    for (const attemptId of [randomUUID(), "not-a-uuid"]) {
      expect(
        await deliver({ kind: "capture-completed", attemptId, orderId: null, captureId: "C" }),
      ).toMatchObject({ status: "processed" });
    }
    expect(h.logs.filter((l) => l.event === "webhook.unknown_payment")).toHaveLength(2);
    expect(await h.store.webhooks.listUnprocessed(10)).toEqual([]);
  });
});

describe("events in any order converge", () => {
  it("a late 'pending' after the payment completed changes nothing", async () => {
    const { h, seeded, deliver } = await setup();
    const id = await buy(h, seeded, "paid");
    const before = await paymentOf(h, id);
    await deliver({
      kind: "capture-pending",
      attemptId: id,
      orderId: before?.paypalOrderId ?? null,
      captureId: before?.captureId ?? "",
    });
    expect((await paymentOf(h, id))?.status).toBe("CAPTURED");
  });

  it("an authorization confirmed after the owner declined is released at once", async () => {
    const { h, seeded, deliver } = await setup();
    h.gateway.nextOrder("timeout-after-commit");
    const id = await buy(h, seeded, "held");
    await declineHold(h.deps, seeded.ownerId, id);
    const [order] = h.gateway.ordersFor(id);
    await deliver({
      kind: "authorization-created",
      attemptId: id,
      orderId: order?.id ?? null,
      authorizationId: order?.authorization?.id ?? "",
    });
    expect((await paymentOf(h, id))?.status).toBe("VOIDED");
    expect(h.gateway.callsTo("voidAuthorization")).toHaveLength(1);
  });

  it("a declined capture of an approved hold releases the authorization it leaves", async () => {
    const { h, seeded, deliver } = await setup();
    const id = await buy(h, seeded, "held");
    h.gateway.nextCapture("timeout-before-commit");
    await driveUntilSettled(
      h.clock,
      approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: 25_000 as Cents }),
      { stepMs: 5_000 },
    );
    expect((await paymentOf(h, id))?.status).toBe("CAPTURING");
    await deliver({ kind: "capture-declined", attemptId: id, captureId: null, reason: "DECLINED" });
    expect((await paymentOf(h, id))?.status).toBe("VOIDED");
  });
});

describe("saved payment methods", () => {
  it("a vault created for a setup activates its mandate", async () => {
    const { h, deliver } = await setup();
    const owner = ownerId(randomUUID());
    await h.store.owners.create({ id: owner, email: null, now: h.clock.now() });
    const started = await startMandate(h.deps, owner);
    if (started.status !== "started") {
      throw new Error(JSON.stringify(started));
    }
    const reference = started.mandate.setupOrderId ?? "";
    h.gateway.approveSetup(reference, { deferVault: true });
    await deliver(h.gateway.deliverDeferredVault(reference));
    expect((await h.store.mandates.get(started.mandate.id))?.status).toBe("ACTIVE");
  });

  it("the owner removed Slip at PayPal: the mandate is revoked, holds released, nothing left to delete", async () => {
    const { h, seeded, deliver } = await setup();
    const id = await buy(h, seeded, "held");
    await deliver({ kind: "vault-token-deleted", vaultId: seeded.vaultId });
    expect(await h.store.mandates.get(seeded.mandateId)).toMatchObject({ status: "REVOKED" });
    expect((await h.store.mandates.get(seeded.mandateId))?.vaultDeletedAt).not.toBeNull();
    expect(await h.store.holds.get(id)).toMatchObject({ status: "DECLINED", decidedBy: "system" });
    expect((await paymentOf(h, id))?.status).toBe("VOIDED");
    expect(h.gateway.callsTo("deleteVaultToken")).toEqual([]);
  });

  it("an event Slip refuses on purpose is logged for a human and not retried for ever", async () => {
    const { h, seeded, deliver } = await setup();
    const owner = ownerId(randomUUID());
    await h.store.owners.create({ id: owner, email: null, now: h.clock.now() });
    const started = await startMandate(h.deps, owner);
    const reference = started.status === "started" ? (started.mandate.setupOrderId ?? "") : "";
    // PayPal reports a saved method that already belongs to another mandate.
    expect(
      await deliver({
        kind: "vault-token-created",
        vaultId: seeded.vaultId,
        customerId: null,
        setupReference: reference,
      }),
    ).toMatchObject({ status: "processed" });
    expect(h.logs).toContainEqual(
      expect.objectContaining({ level: "error", event: "webhook.unprocessable" }),
    );
    expect(await h.store.webhooks.listUnprocessed(10)).toEqual([]);
  });
});

describe("the resolver re-runs events that failed", () => {
  it("an event whose processing failed is stored, PayPal is asked to retry, and the resolver applies it", async () => {
    let failing = true;
    const base = createMemoryStore();
    const store: Store = {
      ...base,
      payments: {
        ...base.payments,
        transition: (...args) => {
          if (failing) {
            throw new Error("connection reset");
          }
          return base.payments.transition(...args);
        },
      },
    };
    const { h, seeded, deliver } = await setup({ store });
    failing = false;
    h.gateway.nextOrder("timeout-before-commit");
    const id = await buy(h, seeded, "paid");
    failing = true;
    expect(
      await deliver({ kind: "capture-completed", attemptId: id, orderId: "O-1", captureId: "C-1" }),
    ).toMatchObject({ status: "retry" });
    expect(await h.store.webhooks.listUnprocessed(10)).toHaveLength(1);

    failing = false;
    await driveUntilSettled(h.clock, runResolver(h.deps));
    expect((await paymentOf(h, id))?.status).toBe("UNKNOWN");
    h.clock.advance(3 * MINUTE);
    const report = await driveUntilSettled(h.clock, runResolver(h.deps), { stepMs: 5_000 });
    expect(report.webhooks).toEqual({ settled: 1, waiting: 0, failed: 0 });
    expect((await paymentOf(h, id))?.status).toBe("CAPTURED");
    expect(await h.store.webhooks.listUnprocessed(10)).toEqual([]);
  });
});
