import { randomUUID } from "node:crypto";
import { createMemoryStore } from "@slip/db/memory";
import type { AttemptId, Cents, PaymentGateway, Store } from "@slip/domain";
import { requestId } from "@slip/domain";
import { driveUntilSettled, offer } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { type Harness, harness, market, type Seeded, seedAgent } from "./__fixtures__/harness.js";
import { runCheckout } from "./checkout/checkout.js";
import type { AppConfigInput } from "./config.js";
import { approveHold, declineHold } from "./holds.js";
import { revokeMandate } from "./mandates.js";
import { runResolver } from "./resolver.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function setup(options: { config?: AppConfigInput; store?: Store } = {}) {
  const h = harness(options);
  const seeded = await seedAgent(h);
  return { h, seeded };
}

let product = 0;

/** An agent checkout, driven past any PayPal deadline: $10 is PAID, $250 is HELD. */
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
    throw new Error(`expected a decision, got ${JSON.stringify(result)}`);
  }
  return result.receipt.attempt.id;
}

const resolve = (h: Harness) => driveUntilSettled(h.clock, runResolver(h.deps), { stepMs: 5_000 });
const statusOf = async (h: Harness, id: AttemptId) => (await h.store.payments.get(id))?.status;
const sent = (h: Harness, method: keyof PaymentGateway) =>
  h.gateway.callsTo(method).map((c) => c.input as Record<string, unknown>);
const approve = (h: Harness, seeded: Seeded, id: AttemptId) =>
  driveUntilSettled(
    h.clock,
    approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: 25_000 as Cents }),
    { stepMs: 5_000 },
  );

describe("orders PayPal may or may not have", () => {
  it("an order lost on its way to PayPal is sent again with the same request id", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("timeout-before-commit");
    const id = await buy(h, seeded, "paid");
    expect(await statusOf(h, id)).toBe("UNKNOWN");
    expect(h.gateway.ordersFor(id)).toHaveLength(0);

    h.clock.advance(3 * MINUTE);
    const report = await resolve(h);
    expect(report.orders).toEqual({ settled: 1, waiting: 0, failed: 0 });
    expect(await statusOf(h, id)).toBe("CAPTURED");
    const requestIds = sent(h, "createOrder").map((input) => input["requestId"]);
    expect(requestIds).toHaveLength(2);
    expect(new Set(requestIds).size).toBe(1);
    expect(h.gateway.ordersFor(id)).toHaveLength(1);
  });

  it("an order PayPal took before the timeout is replayed, never placed twice", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("timeout-after-commit");
    const id = await buy(h, seeded, "paid");
    h.clock.advance(3 * MINUTE);
    await resolve(h);
    expect(await statusOf(h, id)).toBe("CAPTURED");
    expect(h.gateway.ordersFor(id)).toHaveLength(1);
  });

  it("a payment that changed in the last two minutes is left alone: its checkout may still run", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("timeout-before-commit");
    const id = await buy(h, seeded, "paid");
    h.clock.advance(MINUTE);
    const report = await resolve(h);
    expect(report.orders).toEqual({ settled: 0, waiting: 0, failed: 0 });
    expect(await statusOf(h, id)).toBe("UNKNOWN");
    expect(h.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("after 30 minutes nothing is sent again; PayPal's records are searched once they catch up, and only a day later does 'not found' fail it", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("timeout-before-commit");
    const id = await buy(h, seeded, "paid");

    h.clock.advance(31 * MINUTE);
    expect((await resolve(h)).orders.waiting).toBe(1);
    expect(h.gateway.callsTo("createOrder")).toHaveLength(1);
    expect(h.gateway.callsTo("findOrderByInvoice")).toHaveLength(0);

    h.clock.advance(3 * HOUR);
    expect((await resolve(h)).orders.waiting).toBe(1);
    expect(sent(h, "findOrderByInvoice")).toEqual([
      expect.objectContaining({ invoiceId: id, amountCents: 1_000 }),
    ]);
    expect(await statusOf(h, id)).toBe("UNKNOWN");

    h.clock.advance(21 * HOUR);
    expect((await resolve(h)).orders.settled).toBe(1);
    expect(await h.store.payments.get(id)).toMatchObject({
      status: "FAILED",
      failureReason: "ORDER_NOT_FOUND",
    });
    expect(h.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("an order PayPal did take is found by the search and settled", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("timeout-after-commit");
    const id = await buy(h, seeded, "paid");
    h.clock.advance(3 * HOUR + MINUTE);
    await resolve(h);
    expect(await statusOf(h, id)).toBe("CAPTURED");
    expect(h.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("a search PayPal does not answer never fails the payment, however late", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("timeout-before-commit");
    const id = await buy(h, seeded, "paid");
    h.clock.advance(25 * HOUR);
    h.gateway.nextLookup("unknown");
    await resolve(h);
    expect(await statusOf(h, id)).toBe("UNKNOWN");
    expect(h.logs).toContainEqual(
      expect.objectContaining({ level: "error", event: "resolver.lookup_unanswered" }),
    );
  });

  it("a pending order is read until PayPal settles it", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("pending");
    const id = await buy(h, seeded, "paid");
    h.clock.advance(3 * MINUTE);
    expect((await resolve(h)).orders.waiting).toBe(1);
    const orderId = (await h.store.payments.get(id))?.paypalOrderId ?? "";
    h.gateway.settle(orderId, "completed");
    expect((await resolve(h)).orders.settled).toBe(1);
    expect(await statusOf(h, id)).toBe("CAPTURED");
    expect(h.gateway.callsTo("getOrder")).toHaveLength(2);
  });

  it("after a revoke an unconfirmed order is not sent again", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("timeout-before-commit");
    const id = await buy(h, seeded, "paid");
    await h.store.mandates.revoke(seeded.mandateId, h.clock.now());
    h.clock.advance(3 * MINUTE);
    expect((await resolve(h)).orders.waiting).toBe(1);
    expect(await statusOf(h, id)).toBe("UNKNOWN");
    expect(h.gateway.callsTo("createOrder")).toHaveLength(1);
  });
});

describe("holds and their authorizations", () => {
  it("a hold past its 48 hours expires and its reservation is released", async () => {
    const { h, seeded } = await setup();
    const id = await buy(h, seeded, "held");
    h.clock.advance(48 * HOUR);
    const report = await resolve(h);
    expect(report.expireHolds).toEqual({ settled: 1, waiting: 0, failed: 0 });
    expect(await h.store.holds.get(id)).toMatchObject({ status: "EXPIRED", decidedBy: "system" });
    expect(await statusOf(h, id)).toBe("VOIDED");
    expect(h.gateway.callsTo("voidAuthorization")).toHaveLength(1);
  });

  it("a hold declined before PayPal confirmed: nothing is sent again, and the late authorization is released", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("timeout-after-commit");
    const id = await buy(h, seeded, "held");
    await declineHold(h.deps, seeded.ownerId, id);
    expect(await statusOf(h, id)).toBe("UNKNOWN");

    h.clock.advance(3 * MINUTE);
    await resolve(h);
    expect(h.gateway.callsTo("createOrder")).toHaveLength(1);

    h.clock.advance(3 * HOUR);
    const report = await resolve(h);
    expect(report.closedHolds).toEqual({ settled: 1, waiting: 0, failed: 0 });
    expect(await statusOf(h, id)).toBe("VOIDED");
    expect(h.gateway.callsTo("voidAuthorization")).toHaveLength(1);
  });

  it("a capture lost on its way is sent again with its request id", async () => {
    const { h, seeded } = await setup();
    const id = await buy(h, seeded, "held");
    h.gateway.nextCapture("timeout-before-commit");
    await approve(h, seeded, id);
    expect(await statusOf(h, id)).toBe("CAPTURING");
    h.clock.advance(3 * MINUTE);
    expect((await resolve(h)).holdOperations.settled).toBe(1);
    expect(await statusOf(h, id)).toBe("CAPTURED");
    const requestIds = sent(h, "captureAuthorization").map((input) => input["requestId"]);
    expect(requestIds).toHaveLength(2);
    expect(new Set(requestIds).size).toBe(1);
  });

  it("after its window a stuck capture is settled by reading the authorization", async () => {
    const { h, seeded } = await setup();
    const id = await buy(h, seeded, "held");
    h.gateway.nextCapture("timeout-after-commit");
    await approve(h, seeded, id);
    h.clock.advance(31 * MINUTE);
    await resolve(h);
    expect(await statusOf(h, id)).toBe("CAPTURED");
    expect(h.gateway.callsTo("captureAuthorization")).toHaveLength(1);
    expect(h.gateway.callsTo("getAuthorization")).toHaveLength(1);
  });

  it("a void lost on its way is sent again", async () => {
    const { h, seeded } = await setup();
    const id = await buy(h, seeded, "held");
    h.gateway.nextVoid("timeout-before-commit");
    await driveUntilSettled(h.clock, declineHold(h.deps, seeded.ownerId, id), { stepMs: 5_000 });
    expect(await statusOf(h, id)).toBe("VOIDING");
    h.clock.advance(3 * MINUTE);
    await resolve(h);
    expect(await statusOf(h, id)).toBe("VOIDED");
    expect(h.gateway.callsTo("voidAuthorization")).toHaveLength(2);
  });

  it("a capture the owner approved before revoking still completes", async () => {
    const { h, seeded } = await setup();
    const id = await buy(h, seeded, "held");
    h.gateway.nextCapture("timeout-before-commit");
    await approve(h, seeded, id);
    await h.store.mandates.revoke(seeded.mandateId, h.clock.now());
    h.clock.advance(3 * MINUTE);
    await resolve(h);
    expect(await statusOf(h, id)).toBe("CAPTURED");
  });
});

describe("revokes that stopped half-way", () => {
  it("open holds are declined and released, and the PayPal token is deleted", async () => {
    const { h, seeded } = await setup();
    const id = await buy(h, seeded, "held");
    await h.store.mandates.revoke(seeded.mandateId, h.clock.now());

    const report = await resolve(h);
    expect(report.finishRevokes).toEqual({ settled: 1, waiting: 0, failed: 0 });
    expect(report.deleteVaultTokens).toEqual({ settled: 1, waiting: 0, failed: 0 });
    expect(await h.store.holds.get(id)).toMatchObject({ status: "DECLINED", decidedBy: "system" });
    expect(await statusOf(h, id)).toBe("VOIDED");
    expect(h.gateway.hasVault(seeded.vaultId)).toBe(false);
    expect((await h.store.mandates.get(seeded.mandateId))?.vaultDeletedAt).not.toBeNull();
  });

  it("a token deletion PayPal refused is tried again on the next run", async () => {
    const { h, seeded } = await setup();
    await h.store.mandates.revoke(seeded.mandateId, h.clock.now());
    h.gateway.nextDelete("fail");
    expect((await resolve(h)).deleteVaultTokens).toEqual({ settled: 0, waiting: 1, failed: 0 });
    expect(h.gateway.hasVault(seeded.vaultId)).toBe(true);
    expect((await resolve(h)).deleteVaultTokens.settled).toBe(1);
    expect(h.gateway.hasVault(seeded.vaultId)).toBe(false);
    expect((await resolve(h)).deleteVaultTokens).toEqual({ settled: 0, waiting: 0, failed: 0 });
    expect(h.logs.some((l) => JSON.stringify(l).includes(seeded.vaultId))).toBe(false);
  });
});

describe("running at scale", () => {
  it("works through every page, and one item's failure does not stop the others", async () => {
    let broken: string | null = null;
    const base = createMemoryStore();
    const store: Store = {
      ...base,
      attempts: {
        ...base.attempts,
        get: async (id) => {
          if (id === broken) {
            throw new Error("disk on fire");
          }
          return base.attempts.get(id);
        },
      },
    };
    const { h, seeded } = await setup({ store, config: { resolverBatchSize: 1 } });
    h.gateway.nextOrder("timeout-before-commit", "timeout-before-commit");
    const first = await buy(h, seeded, "paid");
    const second = await buy(h, seeded, "paid");
    broken = first;
    h.clock.advance(3 * MINUTE);

    const report = await resolve(h);
    expect(report.orders).toEqual({ settled: 1, waiting: 0, failed: 1 });
    expect(await statusOf(h, second)).toBe("CAPTURED");
    expect(await statusOf(h, first)).toBe("UNKNOWN");
    expect(h.logs).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "resolver.item_failed",
        fields: expect.objectContaining({ task: "orders", id: first }),
      }),
    );
  });

  it("two runs that overlap send each order once", async () => {
    const { h, seeded } = await setup();
    h.gateway.nextOrder("timeout-before-commit", "timeout-before-commit");
    const ids = [await buy(h, seeded, "paid"), await buy(h, seeded, "paid")];
    h.clock.advance(3 * MINUTE);
    await driveUntilSettled(h.clock, Promise.all([runResolver(h.deps), runResolver(h.deps)]), {
      stepMs: 5_000,
    });
    for (const id of ids) {
      expect(await statusOf(h, id)).toBe("CAPTURED");
      expect(h.gateway.ordersFor(id)).toHaveLength(1);
    }
  });
});

describe("checking Slip's books against PayPal's own", () => {
  /** The mandate the harness seeds, which is the one every payment below belongs to. */
  const mandateOf = async (h: Harness, seeded: Seeded) => {
    const mandate = await h.store.mandates.get(seeded.mandateId);
    if (mandate === null) {
      throw new Error("no mandate");
    }
    return mandate;
  };

  it("checks a new permission at once, then leaves it alone for a day", async () => {
    const { h, seeded } = await setup();
    await buy(h, seeded, "paid");
    await resolve(h);
    const first = (await mandateOf(h, seeded)).reconciledAt;
    expect(first).not.toBeNull();
    // Due daily: the next few passes cost PayPal nothing and move the answer not at all.
    h.clock.advance(HOUR);
    await resolve(h);
    expect((await mandateOf(h, seeded)).reconciledAt).toEqual(first);
    expect(sent(h, "listSettlements")).toHaveLength(1);
  });

  it("a payment PayPal has not listed yet is not money gone missing", async () => {
    const { h, seeded } = await setup();
    await buy(h, seeded, "paid");
    // A day on, the permission is due — but the purchase is still inside the reporting lag, so
    // PayPal lists nothing for it. Agreeing to disagree here would be a false alarm every day.
    h.clock.advance(25 * HOUR);
    await resolve(h);
    const mandate = await mandateOf(h, seeded);
    expect(mandate.reconciledAt).not.toBeNull();
    expect(mandate.reconcileUnmatched).toBe(0);
  });

  it("a settled purchase, once PayPal lists it, agrees", async () => {
    const { h, seeded } = await setup();
    await buy(h, seeded, "paid");
    h.clock.advance(4 * HOUR);
    // Past the lag: the stand-in now reports it, and Slip's own payment says the same.
    h.clock.advance(21 * HOUR);
    await resolve(h);
    expect((await mandateOf(h, seeded)).reconcileUnmatched).toBe(0);
    expect(sent(h, "listSettlements")).toHaveLength(1);
  });

  it("money PayPal moved that Slip has no payment for is unaccounted for", async () => {
    const { h, seeded } = await setup();
    // A purchase Slip rejected: no order was ever created, so there is no payment at all.
    product += 1;
    const productId = `product-${product}`;
    // 25% and $20 over: rejected outright. (A wider gap would be held as implausible — D68.)
    const chosen = offer({ price: 100 });
    market(h, productId, [chosen, offer({ price: 80 })]);
    const decided = await driveUntilSettled(
      h.clock,
      runCheckout(h.deps, seeded.apiKey, { productId, chosenOfferUrl: chosen.url, reason: "" }),
      { stepMs: 5_000 },
    );
    if (decided.status !== "decided") {
      throw new Error("expected a decision");
    }
    const id = decided.receipt.attempt.id;
    expect(decided.receipt.attempt.decision.outcome).toBe("REJECTED");
    expect(await h.store.payments.get(id)).toBeNull();

    // PayPal nonetheless has a settled transaction carrying that attempt's id: money moved that
    // Slip never decided. This is the direction no other check in Slip can see.
    h.gateway.addVault("VAULT-RECON");
    await h.gateway.createOrder(
      {
        intent: "CAPTURE",
        vaultId: "VAULT-RECON",
        amountCents: 10_000 as Cents,
        requestId: requestId(randomUUID()),
        invoiceId: id,
        description: "not Slip's doing",
      },
      new AbortController().signal,
    );

    h.clock.advance(25 * HOUR);
    await resolve(h);
    const mandate = await mandateOf(h, seeded);
    expect(mandate.reconciledAt).not.toBeNull();
    expect(mandate.reconcileUnmatched).toBe(1);
  });

  it("PayPal settling more than Slip recorded is a disagreement, not a match", async () => {
    // The first version reduced each invoice to "did money move", so Slip saying $10 and PayPal
    // saying $510 under the same id read as agreement. An amount disagreement is the one thing a
    // reconcile is uniquely placed to see, and it is real money (D76). A second capture of one
    // invoice is also the only place a double charge could ever surface: Slip's payments table
    // holds one row per attempt, so it cannot represent two.
    const { h, seeded } = await setup();
    const id = await buy(h, seeded, "paid");
    h.gateway.addSettlement({ invoiceId: id, amountCents: 50_000, kind: "settled" });
    h.clock.advance(25 * HOUR);
    await resolve(h);
    expect((await mandateOf(h, seeded)).reconcileUnmatched).toBe(1);
  });

  it("a refund Slip never recorded is a disagreement too", async () => {
    // Netting to zero used to be dropped: Slip's receipt still says paid while the money went
    // back. Good news for the owner, and still a book that does not match.
    const { h, seeded } = await setup();
    const id = await buy(h, seeded, "paid");
    const paid = (await h.store.payments.get(id))?.amountCents ?? 0;
    expect(paid).toBeGreaterThan(0);
    h.gateway.addSettlement({ invoiceId: id, amountCents: -paid, kind: "reversed" });
    h.clock.advance(25 * HOUR);
    await resolve(h);
    expect((await mandateOf(h, seeded)).reconcileUnmatched).toBe(1);
  });

  it("a hold the owner declined is not money gone astray", async () => {
    // PayPal lists a released authorization under the same invoice, and the first version read
    // that as a settlement of its own: every declined hold on a desk became an accusation that
    // money had moved and Slip had lost it. Nothing moved — that is what declining a hold means.
    // Found by seeding a demo desk with decided holds on it, which nothing had ever done (D80).
    const { h, seeded } = await setup();
    const id = await buy(h, seeded, "held");
    await driveUntilSettled(h.clock, declineHold(h.deps, seeded.ownerId, id), { stepMs: 5_000 });
    expect(await statusOf(h, id)).toBe("VOIDED");
    h.clock.advance(25 * HOUR);
    await resolve(h);
    expect((await mandateOf(h, seeded)).reconcileUnmatched).toBe(0);
  });

  it("a charge that lands after the kill switch is still reported", async () => {
    // The worst case this can find, and the one the first version silently dropped: the due list
    // took ACTIVE permissions only, so a settlement under a revoked one was counted into a bucket
    // nobody read, with no log line either (D76).
    const { h, seeded } = await setup();
    const id = await buy(h, seeded, "paid");
    h.gateway.addSettlement({ invoiceId: id, amountCents: 50_000, kind: "settled" });
    await revokeMandate(h.deps, seeded.ownerId, seeded.mandateId);
    h.clock.advance(25 * HOUR);
    await resolve(h);
    const mandate = await mandateOf(h, seeded);
    expect(mandate.status).toBe("REVOKED");
    expect(mandate.reconcileUnmatched).toBe(1);
  });

  it("an unanswered search stamps nothing: Slip has not looked", async () => {
    const { h, seeded } = await setup();
    await buy(h, seeded, "paid");
    h.clock.advance(25 * HOUR);
    h.gateway.nextLookup("unknown");
    await resolve(h);
    expect((await mandateOf(h, seeded)).reconciledAt).toBeNull();
  });
});
