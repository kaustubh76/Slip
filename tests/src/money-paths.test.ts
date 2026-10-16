import { randomUUID } from "node:crypto";
import {
  approveHold,
  completeMandateSetup,
  issueAgentKey,
  previewApproval,
  receiveWebhook,
  revokeMandate,
  runCheckout,
  runResolver,
  startMandate,
} from "@slip/app";
import { PgliteTemplate } from "@slip/db/testing";
import { type AttemptId, type Cents, type GatewayEvent, ownerId } from "@slip/domain";
import { offer } from "@slip/domain/testing";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  market,
  openWorld,
  type Seeded,
  type StoreKind,
  seedAgent,
  type World,
} from "./testkit.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * The paths where money could move twice, move after it should have stopped, or never be
 * released — each run on both stores, with every PayPal call counted.
 */
describe.each<StoreKind>(["memory", "pglite"])("money paths on the %s store", (kind) => {
  let template: PgliteTemplate | undefined;
  let w: World;
  let agent: Seeded;

  beforeAll(async () => {
    template = kind === "pglite" ? await PgliteTemplate.create() : undefined;
  });
  afterAll(async () => {
    await template?.close();
  });
  beforeEach(async () => {
    w = await openWorld(kind, template === undefined ? {} : { template });
    agent = await seedAgent(w);
  });
  afterEach(async () => {
    await w.close();
  });

  let product = 0;
  async function buy(kind: "paid" | "held", apiKey = agent.apiKey): Promise<AttemptId> {
    product += 1;
    const productId = `prod-${product}`;
    const chosen = offer({ price: kind === "paid" ? 10 : 250 });
    market(w, productId, [chosen, offer({ price: kind === "paid" ? 11 : 249 })]);
    const result = await w.settle(
      runCheckout(w.deps, apiKey, { productId, chosenOfferUrl: chosen.url, reason: "" }),
    );
    if (result.status !== "decided") {
      throw new Error(JSON.stringify(result));
    }
    return result.receipt.attempt.id;
  }
  const statusOf = async (id: AttemptId) => (await w.store.payments.get(id))?.status;
  const deliver = (event: GatewayEvent) => receiveWebhook(w.deps, w.gateway.webhook(event).request);

  it("an owner sets up a mandate at PayPal, issues a key, and the agent's first purchase is paid", async () => {
    const owner = ownerId(randomUUID());
    await w.store.owners.create({ id: owner, email: "owner@example.com", now: w.clock.now() });
    const started = await startMandate(w.deps, owner, { limits: { orderCapCents: 10_000 } });
    if (started.status !== "started") {
      throw new Error(JSON.stringify(started));
    }
    w.gateway.approveSetup(started.mandate.setupOrderId ?? "");
    expect(await completeMandateSetup(w.deps, owner, started.mandate.id)).toMatchObject({
      status: "active",
    });
    const issued = await issueAgentKey(w.deps, owner, started.mandate.id, { name: "buyer" });
    const apiKey = issued.status === "issued" ? issued.apiKey : "";
    const id = await buy("paid", apiKey);
    expect(await statusOf(id)).toBe("CAPTURED");
  });

  it("the kill switch: nothing is charged or approved afterwards, holds are released, the token is deleted", async () => {
    const held = await buy("held");
    const result = await revokeMandate(w.deps, agent.ownerId, agent.mandateId);
    expect(result).toMatchObject({ status: "revoked", holdsDeclined: 1, vault: "deleted" });
    expect(await statusOf(held)).toBe("VOIDED");
    expect(w.gateway.hasVault(agent.vaultId)).toBe(false);

    const chosen = offer({ price: 10 });
    market(w, "after-revoke", [chosen, offer({ price: 11 })]);
    expect(
      await runCheckout(w.deps, agent.apiKey, {
        productId: "after-revoke",
        chosenOfferUrl: chosen.url,
        reason: "",
      }),
    ).toMatchObject({ reason: "MANDATE_NOT_ACTIVE" });
    expect(w.gateway.callsTo("createOrder")).toHaveLength(1);
    expect(w.gateway.callsTo("captureAuthorization")).toEqual([]);
  });

  it("a revoke that crashed half-way is finished by the resolver, and a refused deletion retried", async () => {
    const held = await buy("held");
    await w.store.mandates.revoke(agent.mandateId, w.clock.now());
    w.gateway.nextDelete("fail");
    await w.settle(runResolver(w.deps));
    expect(await w.store.holds.get(held)).toMatchObject({ status: "DECLINED" });
    expect(await statusOf(held)).toBe("VOIDED");
    expect(w.gateway.hasVault(agent.vaultId)).toBe(true);
    await w.settle(runResolver(w.deps));
    expect(w.gateway.hasVault(agent.vaultId)).toBe(false);
  });

  it("a hold days old still stops a second reservation for the same product", async () => {
    const chosen = offer({ price: 250 });
    market(w, "shoe", [offer({ price: 249 }), chosen]);
    const ask = () =>
      w.settle(
        runCheckout(w.deps, agent.apiKey, {
          productId: "shoe",
          chosenOfferUrl: chosen.url,
          reason: "",
        }),
      );
    await ask();
    w.clock.advance(30 * HOUR);
    expect(await ask()).toMatchObject({ status: "replayed", reason: "HOLD_OPEN" });
    expect(w.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("two identical calls at once make one attempt and at most one order", async () => {
    const chosen = offer({ price: 10 });
    market(w, "race", [chosen, offer({ price: 11 })]);
    const call = () =>
      runCheckout(w.deps, agent.apiKey, {
        productId: "race",
        chosenOfferUrl: chosen.url,
        reason: "",
      });
    const results = await w.settle(Promise.all([call(), call()]));
    expect(results.filter((r) => r.status === "decided")).toHaveLength(1);
    expect(await w.store.attempts.listRecent(agent.agentId, "race", new Date(0))).toHaveLength(1);
    expect(w.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("approving at a price that moved writes nothing", async () => {
    const chosen = offer({ price: 250 });
    w.offers.goDown();
    const held = await w.settle(
      runCheckout(w.deps, agent.apiKey, {
        productId: "moving",
        chosenOfferUrl: chosen.url,
        reason: "",
      }),
    );
    const id = held.status === "decided" ? held.receipt.attempt.id : "";
    w.offers.comeBack();
    market(w, "moving", [
      offer({ price: 249 }),
      offer({ price: 252, url: chosen.url, domain: chosen.domain }),
    ]);
    expect(await previewApproval(w.deps, agent.ownerId, id)).toMatchObject({ amountCents: 25_200 });
    expect(
      await approveHold(w.deps, agent.ownerId, id, { expectedAmountCents: 25_000 as Cents }),
    ).toMatchObject({ reason: "PRICE_CHANGED", amountCents: 25_200 });
    expect(await w.store.holds.get(id as AttemptId)).toMatchObject({ status: "PENDING" });
    expect(await w.store.attempts.findChild(id as AttemptId)).toBeNull();
    expect(w.gateway.calls.filter((c) => c.method === "createOrder")).toEqual([]);
  });

  it("two tabs approving one reserved hold at once capture it once", async () => {
    const held = await buy("held");
    const approve = () =>
      approveHold(w.deps, agent.ownerId, held, { expectedAmountCents: 25_000 as Cents });
    const results = await w.settle(Promise.all([approve(), approve()]));
    expect(results.map((r) => r.status)).toEqual(["done", "done"]);
    expect(w.gateway.callsTo("captureAuthorization")).toHaveLength(1);
    expect(await statusOf(held)).toBe("CAPTURED");
  });

  it("two tabs approving one hold with nothing reserved pay once; the other is told to look again", async () => {
    const chosen = offer({ price: 250 });
    w.offers.goDown();
    const held = await w.settle(
      runCheckout(w.deps, agent.apiKey, {
        productId: "twice",
        chosenOfferUrl: chosen.url,
        reason: "",
      }),
    );
    const id = held.status === "decided" ? held.receipt.attempt.id : "";
    w.offers.comeBack();
    market(w, "twice", [offer({ price: 249 }), chosen]);
    const approve = () =>
      approveHold(w.deps, agent.ownerId, id, { expectedAmountCents: 25_000 as Cents });
    const results = await w.settle(Promise.all([approve(), approve()]));
    // One pays; the other either sees it done or is told the item is busy — never a second order.
    expect(results.filter((r) => r.status === "done")).not.toHaveLength(0);
    for (const r of results) {
      if (r.status === "refused") {
        expect(["BUSY", "ALREADY_DECIDED"]).toContain(r.reason);
      }
    }
    expect(w.gateway.callsTo("createOrder")).toHaveLength(1);
    expect(await w.store.attempts.findChild(id as AttemptId)).not.toBeNull();
  });

  it("an approved hold whose capture PayPal declined is released and never paid another way", async () => {
    const held = await buy("held");
    w.gateway.nextCapture("decline");
    await w.settle(
      approveHold(w.deps, agent.ownerId, held, { expectedAmountCents: 25_000 as Cents }),
    );
    expect(await statusOf(held)).toBe("VOIDED");
    await w.settle(
      approveHold(w.deps, agent.ownerId, held, { expectedAmountCents: 25_000 as Cents }),
    );
    expect(await w.store.attempts.findChild(held)).toBeNull();
    expect(w.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("an order is re-sent only within 30 minutes; a lookup that cannot answer never fails it; 'not found' a day later does", async () => {
    w.gateway.nextOrder("timeout-before-commit");
    const id = await buy("paid");
    w.clock.advance(31 * MINUTE);
    await w.settle(runResolver(w.deps));
    expect(w.gateway.callsTo("createOrder")).toHaveLength(1);

    w.clock.advance(24 * HOUR);
    w.gateway.nextLookup("unknown");
    await w.settle(runResolver(w.deps));
    expect(await statusOf(id)).toBe("UNKNOWN");
    await w.settle(runResolver(w.deps));
    expect(await w.store.payments.get(id)).toMatchObject({
      status: "FAILED",
      failureReason: "ORDER_NOT_FOUND",
    });
  });

  it.each(["webhook first", "resolver first"])(
    "a timed-out order converges whichever report lands first (%s)",
    async (order) => {
      w.gateway.nextOrder("timeout-after-commit");
      const id = await buy("paid");
      const [placed] = w.gateway.ordersFor(id);
      const webhook = () =>
        deliver({
          kind: "capture-completed",
          attemptId: id,
          orderId: placed?.id ?? null,
          captureId: placed?.capture?.id ?? "",
        });
      w.clock.advance(3 * MINUTE);
      if (order === "webhook first") {
        await webhook();
        await w.settle(runResolver(w.deps));
      } else {
        await w.settle(runResolver(w.deps));
        await webhook();
      }
      expect(await w.store.payments.get(id)).toMatchObject({
        status: "CAPTURED",
        paypalOrderId: placed?.id,
        captureId: placed?.capture?.id,
      });
      expect(w.gateway.ordersFor(id)).toHaveLength(1);
    },
  );

  it("a webhook about a payment Slip never made is acknowledged and changes nothing", async () => {
    const id = await buy("paid");
    expect(
      await deliver({
        kind: "capture-declined",
        attemptId: randomUUID(),
        captureId: null,
        reason: "X",
      }),
    ).toMatchObject({ status: "processed" });
    expect(await statusOf(id)).toBe("CAPTURED");
    expect(await w.store.webhooks.listUnprocessed(10)).toEqual([]);
  });
});
