import { randomUUID } from "node:crypto";
import { attemptId, type Cents, type CreateOrderInput, requestId } from "@slip/domain";
import { ManualClock, NOW } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { describeGatewayContract } from "./__contract__/gateway-contract.js";
import { FakePaymentGateway, REPORTING_LAG_MS, REQUEST_ID_RETENTION_MS } from "./fake.js";

describeGatewayContract("fake", async () => {
  const gateway = new FakePaymentGateway({ clock: new ManualClock(NOW) });
  gateway.addVault("VAULT-contract");
  return { gateway, vaultId: "VAULT-contract" };
});

const live = () => new AbortController().signal;
const HOUR = 60 * 60 * 1000;

function setup() {
  const clock = new ManualClock(NOW);
  const gateway = new FakePaymentGateway({ clock });
  gateway.addVault("VAULT-1");
  const order = (overrides: Partial<CreateOrderInput> = {}): CreateOrderInput => ({
    intent: "CAPTURE",
    vaultId: "VAULT-1",
    amountCents: 4799 as Cents,
    requestId: requestId(randomUUID()),
    invoiceId: attemptId(randomUUID()),
    description: "test",
    ...overrides,
  });
  return { clock, gateway, order };
}

/** Starts a call, aborts it as the caller's deadline would, and returns what the caller saw. */
async function withDeadline<T>(call: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const pending = call(controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  return pending;
}

describe("FakePaymentGateway — orders", () => {
  it("timeout after commit: the caller sees unknown, the order exists, the replay finds it", async () => {
    const { gateway, order } = setup();
    gateway.nextOrder("timeout-after-commit");
    const input = order();
    expect((await withDeadline((s) => gateway.createOrder(input, s))).kind).toBe("unknown");
    expect(gateway.ordersFor(input.invoiceId)).toHaveLength(1);
    const replay = await gateway.createOrder(input, live());
    expect(replay.kind).toBe("captured");
    expect(gateway.ordersFor(input.invoiceId)).toHaveLength(1);
  });

  it("timeout before commit: nothing happened, so the retry creates the order once", async () => {
    const { gateway, order } = setup();
    gateway.nextOrder("timeout-before-commit");
    const input = order();
    expect((await withDeadline((s) => gateway.createOrder(input, s))).kind).toBe("unknown");
    expect(gateway.ordersFor(input.invoiceId)).toHaveLength(0);
    expect((await gateway.createOrder(input, live())).kind).toBe("captured");
    expect(gateway.ordersFor(input.invoiceId)).toHaveLength(1);
  });

  it("after 6 hours the request id is forgotten; the invoice id still blocks a second order", async () => {
    const { clock, gateway, order } = setup();
    const input = order();
    await gateway.createOrder(input, live());
    clock.advance(REQUEST_ID_RETENTION_MS);
    expect(await gateway.createOrder(input, live())).toEqual({
      kind: "duplicate-invoice",
      reason: "DUPLICATE_INVOICE_ID",
    });
    expect(gateway.ordersFor(input.invoiceId)).toHaveLength(1);
  });

  it("declines, pending captures that settle later, and re-approval are distinct results", async () => {
    const { gateway, order } = setup();
    gateway.nextOrder("decline", "pending", "payer-action-required");
    expect((await gateway.createOrder(order(), live())).kind).toBe("declined");
    const pending = await gateway.createOrder(order(), live());
    expect(pending.kind).toBe("pending");
    expect((await gateway.createOrder(order(), live())).kind).toBe("payer-action-required");
    if (pending.kind === "pending") {
      gateway.settle(pending.orderId, "completed");
      expect((await gateway.getOrder(pending.orderId, live())).kind).toBe("captured");
    }
  });

  it("a deleted vault token is declined, never charged", async () => {
    const { gateway, order } = setup();
    expect(await gateway.deleteVaultToken("VAULT-1", live())).toEqual({ kind: "deleted" });
    expect(await gateway.deleteVaultToken("VAULT-1", live())).toEqual({ kind: "already-gone" });
    const result = await gateway.createOrder(order(), live());
    expect(result).toMatchObject({ kind: "declined", reason: "vault token deleted" });
  });

  it("Transaction Search sees an order only after the 3-hour reporting lag", async () => {
    const { clock, gateway, order } = setup();
    const input = order();
    await gateway.createOrder(input, live());
    const find = () =>
      gateway.findOrderByInvoice(
        {
          invoiceId: input.invoiceId,
          amountCents: input.amountCents,
          from: new Date(NOW.getTime() - HOUR),
          to: new Date(clock.now().getTime() + HOUR),
        },
        live(),
      );
    expect(await find()).toEqual({ kind: "not-found" });
    clock.advance(REPORTING_LAG_MS);
    expect((await find()).kind).toBe("found");
    gateway.nextLookup("unknown");
    expect((await find()).kind).toBe("unknown");
  });
});

describe("FakePaymentGateway — authorizations", () => {
  async function authorized() {
    const s = setup();
    const result = await s.gateway.createOrder(s.order({ intent: "AUTHORIZE" }), live());
    if (result.kind !== "authorized") {
      throw new Error("expected an authorization");
    }
    return { ...s, authorizationId: result.authorizationId };
  }

  const captureInput = (authorizationId: string) => ({
    authorizationId,
    amountCents: 4799 as Cents,
    requestId: requestId(randomUUID()),
    invoiceId: attemptId(randomUUID()),
    finalCapture: true as const,
  });

  it("a declined capture leaves the authorization alive, so it can still be voided", async () => {
    const { gateway, authorizationId } = await authorized();
    gateway.nextCapture("decline");
    expect((await gateway.captureAuthorization(captureInput(authorizationId), live())).kind).toBe(
      "declined",
    );
    expect(await gateway.getAuthorization(authorizationId, live())).toMatchObject({
      status: "CREATED",
    });
    expect(
      await gateway.voidAuthorization(
        { authorizationId, requestId: requestId(randomUUID()) },
        live(),
      ),
    ).toEqual({ kind: "voided" });
  });

  it("a capture that timed out after commit is found by replaying its request id", async () => {
    const { gateway, authorizationId } = await authorized();
    gateway.nextCapture("timeout-after-commit");
    const input = captureInput(authorizationId);
    expect((await withDeadline((s) => gateway.captureAuthorization(input, s))).kind).toBe(
      "unknown",
    );
    expect((await gateway.captureAuthorization(input, live())).kind).toBe("captured");
  });

  it("an authorization that expired at PayPal cannot be voided or captured", async () => {
    const { gateway, authorizationId } = await authorized();
    gateway.endAuthorization(authorizationId, "EXPIRED");
    expect(
      await gateway.voidAuthorization(
        { authorizationId, requestId: requestId(randomUUID()) },
        live(),
      ),
    ).toEqual({ kind: "not-voidable", status: "EXPIRED", captureId: null });
    expect((await gateway.captureAuthorization(captureInput(authorizationId), live())).kind).toBe(
      "declined",
    );
  });
});

describe("FakePaymentGateway — vault setup and webhooks", () => {
  const setupInput = () => ({
    mandateId: randomUUID() as never,
    requestId: requestId(randomUUID()),
    returnUrl: "https://slip.test/return",
    cancelUrl: "https://slip.test/cancel",
  });

  it("not approved, then approved and vaulted", async () => {
    const { gateway } = setup();
    const started = await gateway.startVaultSetup(setupInput(), live());
    if (started.kind !== "started") {
      throw new Error("expected a setup");
    }
    const complete = () =>
      gateway.completeVaultSetup(
        { reference: started.reference, requestId: requestId(randomUUID()) },
        live(),
      );
    expect(await complete()).toEqual({ kind: "not-approved" });
    gateway.approveSetup(started.reference);
    const vaulted = await complete();
    expect(vaulted.kind).toBe("vaulted");
    if (vaulted.kind === "vaulted") {
      expect(gateway.hasVault(vaulted.vaultId)).toBe(true);
    }
  });

  it("a deferred vault is pending until PayPal's webhook delivers it", async () => {
    const { gateway } = setup();
    const started = await gateway.startVaultSetup(setupInput(), live());
    if (started.kind !== "started") {
      throw new Error("expected a setup");
    }
    gateway.approveSetup(started.reference, { deferVault: true });
    expect(
      (
        await gateway.completeVaultSetup(
          { reference: started.reference, requestId: requestId(randomUUID()) },
          live(),
        )
      ).kind,
    ).toBe("pending");
    const event = gateway.deliverDeferredVault(started.reference);
    expect(event).toMatchObject({ kind: "vault-token-created", setupReference: started.reference });
  });

  it("webhooks verify only when signed and interpret back to the event", async () => {
    const { gateway } = setup();
    const event = { kind: "vault-token-deleted", vaultId: "VAULT-1" } as const;
    const signed = gateway.webhook(event);
    expect(await gateway.verifyWebhook(signed.request, live())).toBe(true);
    expect(
      await gateway.verifyWebhook(gateway.webhook(event, { signed: false }).request, live()),
    ).toBe(false);
    expect(gateway.interpretWebhook(signed.payload)).toEqual(event);
    expect(gateway.interpretWebhook({ event_type: "BILLING.PLAN.CREATED" })).toEqual({
      kind: "ignored",
      eventType: "BILLING.PLAN.CREATED",
    });
  });

  it("logs every call", async () => {
    const { gateway, order } = setup();
    await gateway.createOrder(order(), live());
    expect(gateway.callsTo("createOrder")).toHaveLength(1);
    expect(gateway.callsTo("captureAuthorization")).toHaveLength(0);
  });
});
