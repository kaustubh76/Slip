import { randomUUID } from "node:crypto";
import { type Cents, type Offer, ownerId } from "@slip/domain";
import { driveUntilSettled, offer } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { type Harness, harness, market, type Seeded, seedAgent } from "./__fixtures__/harness.js";
import { runCheckout } from "./checkout/checkout.js";
import { approveHold, declineHold, previewApproval } from "./holds.js";

const cents = (n: number) => n as Cents;
const MINUTE = 60_000;

interface Held {
  h: Harness;
  seeded: Seeded;
  id: string;
  chosen: Offer;
}

/**
 * An agent buys a $250 item against a $249 one: above the $200 cap, so it is HELD. By default
 * PayPal reserves the money; `channel3Down` leaves the hold with no order at all.
 */
async function heldPurchase(options: { channel3Down?: boolean } = {}): Promise<Held> {
  const h = harness();
  const seeded = await seedAgent(h);
  const chosen = offer({ price: 250, domain: "store-b.example" });
  if (options.channel3Down) {
    h.offers.goDown();
  } else {
    market(h, "p1", [offer({ price: 249 }), chosen], { title: "Trail shoe" });
  }
  const result = await driveUntilSettled(
    h.clock,
    runCheckout(h.deps, seeded.apiKey, {
      productId: "p1",
      chosenOfferUrl: chosen.url,
      reason: "best I found",
    }),
    { stepMs: 5_000 },
  );
  if (result.status !== "decided" || result.receipt.attempt.decision.outcome !== "HELD") {
    throw new Error(`expected a HELD checkout, got ${JSON.stringify(result)}`);
  }
  return { h, seeded, id: result.receipt.attempt.id, chosen };
}

/** Channel3 lists the held item again, at `price`, next to a $249 offer. */
function relist(held: Held, price: number, other = 249) {
  const { chosen } = held;
  market(held.h, "p1", [
    offer({ price: other }),
    offer({ price, url: chosen.url, domain: chosen.domain }),
  ]);
}

describe("a hold with money reserved", () => {
  it("previews the reserved amount, then captures it once, in full", async () => {
    const { h, seeded, id } = await heldPurchase();
    const preview = await previewApproval(h.deps, seeded.ownerId, id);
    expect(preview).toMatchObject({
      status: "preview",
      kind: "capture",
      amountCents: 25_000,
      merchant: "store-b.example",
    });

    const approved = await approveHold(h.deps, seeded.ownerId, id, {
      expectedAmountCents: cents(25_000),
    });
    expect(approved.status === "done" && approved.view).toMatchObject({
      paymentStatus: "CAPTURED",
      charged: true,
      hold: { status: "APPROVED" },
    });
    if (approved.status !== "done") {
      return;
    }
    expect(approved.followUp).toBeNull();
    const payment = approved.receipt.payment;
    expect(h.gateway.callsTo("captureAuthorization").map((c) => c.input)).toEqual([
      {
        authorizationId: payment?.authorizationId,
        amountCents: 25_000,
        requestId: payment?.operations.find((op) => op.kind === "CAPTURE")?.requestId,
        invoiceId: id,
        finalCapture: true,
      },
    ]);
  });

  it("a second approval (a double click) changes nothing and captures nothing more", async () => {
    const { h, seeded, id } = await heldPurchase();
    await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) });
    const again = await approveHold(h.deps, seeded.ownerId, id, {
      expectedAmountCents: cents(25_000),
    });
    expect(again.status === "done" && again.view.paymentStatus).toBe("CAPTURED");
    expect(h.gateway.callsTo("captureAuthorization")).toHaveLength(1);
  });

  it("an amount other than the reserved one is refused and the hold stays open", async () => {
    const { h, seeded, id } = await heldPurchase();
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(24_900) }),
    ).toMatchObject({ status: "refused", reason: "PRICE_CHANGED", amountCents: 25_000 });
    expect((await h.store.holds.get(id as never))?.status).toBe("PENDING");
    expect(h.gateway.callsTo("captureAuthorization")).toEqual([]);
  });

  it("a declined capture releases the authorization, and the hold is never paid another way", async () => {
    const { h, seeded, id } = await heldPurchase();
    h.gateway.nextCapture("decline");
    const approved = await approveHold(h.deps, seeded.ownerId, id, {
      expectedAmountCents: cents(25_000),
    });
    expect(approved.status === "done" && approved.view).toMatchObject({
      paymentStatus: "VOIDED",
      charged: false,
      hold: { status: "APPROVED" },
    });
    expect(h.gateway.callsTo("voidAuthorization")).toHaveLength(1);

    const again = await approveHold(h.deps, seeded.ownerId, id, {
      expectedAmountCents: cents(25_000),
    });
    expect(again.status === "done" && again.followUp).toBeNull();
    expect(h.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("a capture that times out stays CAPTURING for the resolver; a repeat does not re-send it", async () => {
    const { h, seeded, id } = await heldPurchase();
    h.gateway.nextCapture("timeout-after-commit");
    const approved = await driveUntilSettled(
      h.clock,
      approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) }),
      { stepMs: 5_000 },
    );
    expect(approved.status === "done" && approved.view).toMatchObject({
      paymentStatus: "CAPTURING",
      charged: false,
    });
    await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) });
    expect(h.gateway.callsTo("captureAuthorization")).toHaveLength(1);
  });

  it("a reservation PayPal has not confirmed is not ready to approve", async () => {
    const h = harness();
    const seeded = await seedAgent(h);
    const chosen = offer({ price: 250 });
    market(h, "p1", [offer({ price: 249 }), chosen]);
    h.gateway.nextOrder("timeout-before-commit");
    const result = await driveUntilSettled(
      h.clock,
      runCheckout(h.deps, seeded.apiKey, {
        productId: "p1",
        chosenOfferUrl: chosen.url,
        reason: "",
      }),
      { stepMs: 5_000 },
    );
    const id = result.status === "decided" ? result.receipt.attempt.id : "";
    expect(result.status === "decided" && result.view.paymentStatus).toBe("UNKNOWN");
    expect(await previewApproval(h.deps, seeded.ownerId, id)).toMatchObject({
      reason: "NOT_READY",
    });
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) }),
    ).toMatchObject({ reason: "NOT_READY" });
    expect(h.gateway.callsTo("captureAuthorization")).toEqual([]);
  });
});

describe("a hold with nothing reserved", () => {
  it("is checked again and paid in one step by an owner-approval attempt", async () => {
    const held = await heldPurchase({ channel3Down: true });
    const { h, seeded, id } = held;
    expect(h.gateway.calls).toEqual([]);
    h.offers.comeBack();
    relist(held, 250);

    const preview = await previewApproval(h.deps, seeded.ownerId, id);
    expect(preview).toMatchObject({ status: "preview", kind: "pay", amountCents: 25_000 });
    expect(h.gateway.calls).toEqual([]);

    const approved = await approveHold(h.deps, seeded.ownerId, id, {
      expectedAmountCents: cents(25_000),
    });
    if (approved.status !== "done" || approved.followUp === null) {
      throw new Error(`expected a follow-up, got ${JSON.stringify(approved)}`);
    }
    expect(approved.view.hold?.status).toBe("APPROVED");
    const child = approved.followUp.receipt;
    expect(child.attempt).toMatchObject({
      origin: "OWNER_APPROVAL",
      parentAttemptId: id,
      decision: { outcome: "PAID", ruleCode: "OWNER_APPROVED" },
    });
    // The re-check's own finding is kept behind the owner's decision.
    expect(child.attempt.decision.checkResult.ruleCodes).toEqual([
      "OWNER_APPROVED",
      "R6_ABOVE_ORDER_CAP",
    ]);
    expect(approved.followUp.view).toMatchObject({ paymentStatus: "CAPTURED", charged: true });
    expect(h.gateway.callsTo("createOrder").map((c) => c.input)).toEqual([
      expect.objectContaining({
        intent: "CAPTURE",
        vaultId: seeded.vaultId,
        amountCents: 25_000,
        invoiceId: child.attempt.id,
      }),
    ]);
  });

  it("an authorization PayPal declined is followed up the same way", async () => {
    const h = harness();
    const seeded = await seedAgent(h);
    const chosen = offer({ price: 250 });
    market(h, "p1", [offer({ price: 249 }), chosen]);
    h.gateway.nextOrder("decline");
    const result = await runCheckout(h.deps, seeded.apiKey, {
      productId: "p1",
      chosenOfferUrl: chosen.url,
      reason: "",
    });
    const id = result.status === "decided" ? result.receipt.attempt.id : "";
    expect(result.status === "decided" && result.view.paymentStatus).toBe("FAILED");

    const approved = await approveHold(h.deps, seeded.ownerId, id, {
      expectedAmountCents: cents(25_000),
    });
    expect(approved.status === "done" && approved.followUp?.view.paymentStatus).toBe("CAPTURED");
    expect(h.gateway.callsTo("createOrder").map((c) => c.input)).toEqual([
      expect.objectContaining({ intent: "AUTHORIZE" }),
      expect.objectContaining({ intent: "CAPTURE" }),
    ]);
  });

  it("a price that moved since the preview is refused with the new amount, and nothing is written", async () => {
    const held = await heldPurchase({ channel3Down: true });
    const { h, seeded, id } = held;
    h.offers.comeBack();
    relist(held, 250);
    await previewApproval(h.deps, seeded.ownerId, id);

    h.clock.advance(11 * MINUTE);
    relist(held, 255, 254);
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) }),
    ).toMatchObject({ status: "refused", reason: "PRICE_CHANGED", amountCents: 25_500 });
    expect((await h.store.holds.get(id as never))?.status).toBe("PENDING");
    expect(await h.store.attempts.findChild(id as never)).toBeNull();
    expect(h.gateway.calls).toEqual([]);

    const approved = await approveHold(h.deps, seeded.ownerId, id, {
      expectedAmountCents: cents(25_500),
    });
    expect(approved.status === "done" && approved.followUp?.view.paymentStatus).toBe("CAPTURED");
  });

  it("a re-check that would now reject is refused: the owner overrides a hold, never a rejection", async () => {
    const held = await heldPurchase({ channel3Down: true });
    const { h, seeded, id } = held;
    h.offers.comeBack();
    relist(held, 300, 250);
    expect(await previewApproval(h.deps, seeded.ownerId, id)).toMatchObject({
      reason: "RECHECK_REJECTED",
      ruleCode: "R4_OVERPAID",
    });
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(30_000) }),
    ).toMatchObject({ reason: "RECHECK_REJECTED" });
    expect(await h.store.attempts.findChild(id as never)).toBeNull();
    expect(h.gateway.calls).toEqual([]);
  });

  it("with Channel3 still down there is no price to pay, so it is refused", async () => {
    const { h, seeded, id } = await heldPurchase({ channel3Down: true });
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) }),
    ).toMatchObject({ reason: "PRICES_UNAVAILABLE" });
    expect((await h.store.holds.get(id as never))?.status).toBe("PENDING");
  });

  it("previews that arrive together ask Channel3 once, not once each", async () => {
    // A preview on this kind of hold asks Channel3 for today's prices and the classifier about
    // the listing — both paid, both on the operator's keys. The snapshot's freshness window
    // bounds a series of previews and bounds nothing about previews that arrive at the same
    // instant: they all read the same stale snapshot, all miss, and all pay (D83).
    const held = await heldPurchase({ channel3Down: true });
    const { h, seeded, id } = held;
    h.offers.comeBack();
    relist(held, 250);
    const asked = h.offers.calls.length;

    const answers = await Promise.all(
      Array.from({ length: 5 }, () => previewApproval(h.deps, seeded.ownerId, id)),
    );
    expect(h.offers.calls.length - asked).toBe(1);
    // One of them priced it; the rest were told to come back rather than made to pay again.
    expect(answers.filter((a) => a.status === "preview")).toHaveLength(1);
    expect(answers.filter((a) => a.status === "refused" && a.reason === "BUSY")).toHaveLength(4);
    // Nothing was decided by any of them.
    expect((await h.store.holds.get(id as never))?.status).toBe("PENDING");
  });

  it("releases the lease it took, so the owner's next click is not refused", async () => {
    const held = await heldPurchase({ channel3Down: true });
    const { h, seeded, id } = held;
    h.offers.comeBack();
    relist(held, 250);
    expect(await previewApproval(h.deps, seeded.ownerId, id)).toMatchObject({ kind: "pay" });
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) }),
    ).toMatchObject({ status: "done" });
  });

  it("is BUSY while a checkout for the same product holds the lease", async () => {
    const held = await heldPurchase({ channel3Down: true });
    const { h, seeded, id } = held;
    h.offers.comeBack();
    relist(held, 250);
    const key = { agentId: seeded.agentId, productId: "p1" };
    await h.store.leases.acquire(key, "agent-checkout", 60_000, h.clock.now());
    const asked = h.offers.calls.length;
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) }),
    ).toMatchObject({ reason: "BUSY" });
    expect(h.offers.calls).toHaveLength(asked);
    expect((await h.store.holds.get(id as never))?.status).toBe("PENDING");
  });
});

describe("declining, revoking, expiry and ownership", () => {
  it("declining releases the reservation once; declining again changes nothing", async () => {
    const { h, seeded, id } = await heldPurchase();
    const declined = await declineHold(h.deps, seeded.ownerId, id);
    expect(declined.status === "done" && declined.view).toMatchObject({
      paymentStatus: "VOIDED",
      charged: false,
      hold: { status: "DECLINED" },
    });
    expect((await declineHold(h.deps, seeded.ownerId, id)).status).toBe("done");
    expect(h.gateway.callsTo("voidAuthorization")).toHaveLength(1);
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) }),
    ).toMatchObject({ reason: "ALREADY_DECIDED" });
  });

  it("after a revoke nothing can be approved, but declining still releases the money", async () => {
    const { h, seeded, id } = await heldPurchase();
    await h.store.mandates.revoke(seeded.mandateId, h.clock.now());
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) }),
    ).toMatchObject({ reason: "MANDATE_NOT_ACTIVE" });
    expect(await previewApproval(h.deps, seeded.ownerId, id)).toMatchObject({
      reason: "MANDATE_NOT_ACTIVE",
    });
    const declined = await declineHold(h.deps, seeded.ownerId, id);
    expect(declined.status === "done" && declined.view.paymentStatus).toBe("VOIDED");
    expect(h.gateway.callsTo("captureAuthorization")).toEqual([]);
  });

  it("a hold past its 48 hours cannot be approved", async () => {
    const { h, seeded, id } = await heldPurchase();
    h.clock.advance(48 * 60 * MINUTE);
    expect(
      await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: cents(25_000) }),
    ).toMatchObject({ reason: "EXPIRED" });
    expect(h.gateway.callsTo("captureAuthorization")).toEqual([]);
  });

  it("another owner's hold, a paid attempt and a malformed id are all 'not found'", async () => {
    const { h, seeded, id } = await heldPurchase();
    const stranger = ownerId(randomUUID());
    expect(await previewApproval(h.deps, stranger, id)).toMatchObject({ reason: "NOT_FOUND" });
    expect(
      await approveHold(h.deps, stranger, id, { expectedAmountCents: cents(25_000) }),
    ).toMatchObject({ reason: "NOT_FOUND" });
    expect(await declineHold(h.deps, stranger, id)).toMatchObject({ reason: "NOT_FOUND" });
    expect(await declineHold(h.deps, seeded.ownerId, "not-a-uuid")).toMatchObject({
      reason: "NOT_FOUND",
    });

    const cheap = offer({ price: 10 });
    market(h, "p2", [cheap, offer({ price: 11 })]);
    const paid = await runCheckout(h.deps, seeded.apiKey, {
      productId: "p2",
      chosenOfferUrl: cheap.url,
      reason: "",
    });
    const paidId = paid.status === "decided" ? paid.receipt.attempt.id : "";
    expect(await declineHold(h.deps, seeded.ownerId, paidId)).toMatchObject({
      reason: "NOT_FOUND",
    });
    expect((await h.store.holds.get(id as never))?.status).toBe("PENDING");
  });
});
