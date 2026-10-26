import type { Store } from "@slip/domain";
import { driveUntilSettled, offer } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { type Harness, harness, market, seedAgent } from "../__fixtures__/harness.js";
import { runCheckout } from "./checkout.js";
import { recordShown } from "./search-context.js";

async function setup(options: { storeOverride?: (store: Store) => Store } = {}) {
  const base = harness();
  const h: Harness =
    options.storeOverride === undefined
      ? base
      : { ...base, deps: { ...base.deps, store: options.storeOverride(base.store) } };
  const seeded = await seedAgent(base);
  return { h, seeded };
}

const ask = (h: Harness, apiKey: string, productId: string, url: string, extra: object = {}) =>
  runCheckout(h.deps, apiKey, { productId, chosenOfferUrl: url, reason: "best I found", ...extra });

describe("runCheckout", () => {
  it("the cheapest offer is paid in one step with the request id and vault id recorded first", async () => {
    const { h, seeded } = await setup();
    const cheap = offer({ price: 47.99, domain: "store-b.example" });
    market(h, "p1", [offer({ price: 54.99 }), cheap], { title: "Trail shoe" });
    const result = await ask(h, seeded.apiKey, "p1", cheap.url, { price: 0.01 });
    expect(result.status).toBe("decided");
    if (result.status !== "decided") {
      return;
    }
    expect(result.view).toMatchObject({
      outcome: "PAID",
      paymentStatus: "CAPTURED",
      charged: true,
    });
    const [call] = h.gateway.callsTo("createOrder");
    expect(call?.input).toMatchObject({
      intent: "CAPTURE",
      vaultId: seeded.vaultId,
      amountCents: 4799,
      invoiceId: result.receipt.attempt.id,
      requestId: result.receipt.payment?.operations[0]?.requestId,
      description: "Slip: Trail shoe from store-b.example",
    });
  });

  it("an overpayment is rejected and PayPal is never called", async () => {
    const { h, seeded } = await setup();
    const pricey = offer({ price: 140 });
    market(h, "p1", [offer({ price: 125 }), pricey]);
    const result = await ask(h, seeded.apiKey, "p1", pricey.url);
    expect(result.status === "decided" && result.view).toMatchObject({
      outcome: "REJECTED",
      ruleCode: "R4_OVERPAID",
      charged: false,
    });
    expect(h.gateway.calls).toEqual([]);
  });

  it("an order above the cap is held, with the money only reserved", async () => {
    const { h, seeded } = await setup();
    const big = offer({ price: 250 });
    market(h, "p1", [offer({ price: 249 }), big]);
    const result = await ask(h, seeded.apiKey, "p1", big.url);
    expect(result.status === "decided" && result.view).toMatchObject({
      outcome: "HELD",
      paymentStatus: "AUTHORIZED",
      charged: false,
      hold: { status: "PENDING" },
    });
    expect(h.gateway.callsTo("createOrder")[0]?.input).toMatchObject({ intent: "AUTHORIZE" });
    expect(h.gateway.callsTo("captureAuthorization")).toEqual([]);
  });

  it("Channel3 down: held with no order at all", async () => {
    const { h, seeded } = await setup();
    h.offers.goDown();
    const result = await ask(h, seeded.apiKey, "p1", "https://store-a.example/p/1");
    expect(result.status === "decided" && result.view).toMatchObject({
      outcome: "HELD",
      ruleCode: "R1_STALE_SNAPSHOT",
      paymentStatus: "NONE",
    });
    expect(h.gateway.calls).toEqual([]);
  });

  it("a declined order is FAILED and nothing is charged", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("decline");
    const cheap = offer({ price: 10 });
    market(h, "p1", [cheap, offer({ price: 11 })]);
    const result = await ask(h, seeded.apiKey, "p1", cheap.url);
    expect(result.status === "decided" && result.view).toMatchObject({
      outcome: "PAID",
      paymentStatus: "FAILED",
      charged: false,
    });
  });

  it("a PayPal timeout leaves the payment UNKNOWN: one order exists, none is re-sent here", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("timeout-after-commit");
    const cheap = offer({ price: 10 });
    market(h, "p1", [cheap, offer({ price: 11 })]);
    const result = await driveUntilSettled(h.clock, ask(h, seeded.apiKey, "p1", cheap.url), {
      stepMs: 5_000,
    });
    expect(result.status === "decided" && result.view).toMatchObject({
      paymentStatus: "UNKNOWN",
      charged: false,
    });
    if (result.status === "decided") {
      expect(h.gateway.ordersFor(result.receipt.attempt.id)).toHaveLength(1);
    }
    expect(h.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("the same call twice buys once: the second is a replay", async () => {
    const { h, seeded } = await setup();
    const cheap = offer({ price: 10 });
    market(h, "p1", [cheap, offer({ price: 11 })]);
    const first = await ask(h, seeded.apiKey, "p1", cheap.url);
    const second = await ask(h, seeded.apiKey, "p1", cheap.url);
    expect(second).toMatchObject({ status: "replayed", reason: "ALREADY_PAID" });
    if (first.status === "decided" && second.status === "replayed") {
      expect(second.receipt.attempt.id).toBe(first.receipt.attempt.id);
    }
    expect(h.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("an open hold, even an old one, is replayed instead of reserving twice", async () => {
    const { h, seeded } = await setup();
    const big = offer({ price: 250 });
    market(h, "p1", [offer({ price: 249 }), big]);
    await ask(h, seeded.apiKey, "p1", big.url);
    h.clock.advance(6 * 60 * 60 * 1000);
    const again = await ask(h, seeded.apiKey, "p1", big.url);
    expect(again).toMatchObject({ status: "replayed", reason: "HOLD_OPEN" });
    expect(h.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("a second call while one is running is BUSY, and the lease is released afterwards", async () => {
    const { h, seeded } = await setup();
    const cheap = offer({ price: 10 });
    market(h, "p1", [cheap, offer({ price: 11 })]);
    await h.store.leases.acquire(
      { agentId: seeded.agentId, productId: "p1" },
      "someone",
      60_000,
      h.clock.now(),
    );
    expect(await ask(h, seeded.apiKey, "p1", cheap.url)).toMatchObject({
      status: "refused",
      reason: "BUSY",
    });
    await h.store.leases.release({ agentId: seeded.agentId, productId: "p1" }, "someone");
    expect((await ask(h, seeded.apiKey, "p1", cheap.url)).status).toBe("decided");
    expect(
      await h.store.leases.acquire(
        { agentId: seeded.agentId, productId: "p1" },
        "next",
        60_000,
        h.clock.now(),
      ),
    ).toBe(true);
  });

  it("the fifth attempt for a product within the hour is refused", async () => {
    const { h, seeded } = await setup();
    const offers = [1, 2, 3, 4, 5].map((i) =>
      offer({ price: 140 + i, url: `https://store-x.example/p/${i}` }),
    );
    market(h, "p1", [offer({ price: 100 }), ...offers]);
    for (const o of offers.slice(0, 4)) {
      expect((await ask(h, seeded.apiKey, "p1", o.url)).status).toBe("decided");
    }
    expect(await ask(h, seeded.apiKey, "p1", offers[4]?.url ?? "")).toMatchObject({
      status: "refused",
      reason: "RETRY_LIMIT",
    });
  });

  it("limits changed mid-checkout: the check re-runs under the new policy, the classifier is not asked twice", async () => {
    let changed = false;
    let seededMandate = "";
    const { h, seeded } = await setup({
      storeOverride: (store) => ({
        ...store,
        attempts: {
          ...store.attempts,
          record: async (input) => {
            if (!changed) {
              changed = true;
              await store.mandates.updatePolicy(
                input.attempt.mandateId,
                { orderCapCents: 50_000 as never },
                input.attempt.createdAt,
              );
            }
            seededMandate = input.attempt.mandateId;
            return store.attempts.record(input);
          },
        },
      }),
    });
    const big = offer({ price: 250, text: "Top pick" });
    market(h, "p1", [offer({ price: 245 }), big]);
    const shown = "Trail shoe. A perfectly ordinary description.";
    await recordShown(h.deps, seeded.agentId, [{ productId: "p1", text: shown }], h.clock.now());
    const result = await ask(h, seeded.apiKey, "p1", big.url);
    expect(seededMandate).toBe(seeded.mandateId);
    // Under v1 ($200 cap) it would be HELD; under v2 ($500 cap) the 2 % gap pays.
    expect(result.status === "decided" && result.view).toMatchObject({
      outcome: "PAID",
      policyVersion: 2,
    });
    expect(h.classifier.calls).toHaveLength(1);
    // Round two replays the verdict rather than paying for a second one, so it has to replay the
    // text with it: the decision that gets recorded is round two's (D87).
    expect(result.status === "decided" && result.view.searchText).toBe(shown);
  });

  it("a revoke that lands mid-checkout refuses it and writes nothing", async () => {
    const { h, seeded } = await setup({
      storeOverride: (store) => ({
        ...store,
        attempts: {
          ...store.attempts,
          record: async (input) => {
            await store.mandates.revoke(input.attempt.mandateId, input.attempt.createdAt);
            return store.attempts.record(input);
          },
        },
      }),
    });
    const cheap = offer({ price: 10 });
    market(h, "p1", [cheap, offer({ price: 11 })]);
    expect(await ask(h, seeded.apiKey, "p1", cheap.url)).toMatchObject({
      status: "refused",
      reason: "MANDATE_NOT_ACTIVE",
    });
    expect(h.gateway.calls).toEqual([]);
    expect(await h.store.attempts.listRecent(seeded.agentId, "p1", new Date(0))).toEqual([]);
  });

  it("an unknown key or a revoked mandate is refused before anything happens", async () => {
    const { h, seeded } = await setup();
    expect(await ask(h, "slip_live_nope", "p1", "https://x.example/p")).toMatchObject({
      reason: "UNAUTHENTICATED",
    });
    await h.store.mandates.revoke(seeded.mandateId, h.clock.now());
    expect(await ask(h, seeded.apiKey, "p1", "https://x.example/p")).toMatchObject({
      reason: "MANDATE_NOT_ACTIVE",
    });
    expect(h.offers.calls).toEqual([]);
  });
});
