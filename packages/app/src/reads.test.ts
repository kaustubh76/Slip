import type { Cents } from "@slip/domain";
import { offer } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { harness, market, seedAgent } from "./__fixtures__/harness.js";
import { issueAgentKey, revokeAgentKey } from "./agents.js";
import { runCheckout } from "./checkout/checkout.js";
import { approveHold } from "./holds.js";
import { getReceipt, getReport } from "./reads.js";

async function setup() {
  const h = harness();
  const seeded = await seedAgent(h);
  const cheap = offer({ price: 10 });
  market(h, "p1", [cheap, offer({ price: 11 })]);
  // 20 % and $20 over the best offer: rejected as overpaid. Kept under the implausible-gap
  // ceiling (D68), above which a gap is treated as a catalogue error and held instead.
  const pricey = offer({ price: 120 });
  market(h, "p3", [offer({ price: 100 }), pricey]);
  const buy = async (url: string, productId = "p1") => {
    const result = await runCheckout(h.deps, seeded.apiKey, {
      productId,
      chosenOfferUrl: url,
      reason: "",
    });
    if (result.status !== "decided") {
      throw new Error(JSON.stringify(result));
    }
    return result.receipt.attempt.id;
  };
  return { h, seeded, buy, cheap, pricey };
}

describe("getReceipt", () => {
  it("an agent reads its own receipt, and no one else's", async () => {
    const { h, seeded, buy, cheap } = await setup();
    const id = await buy(cheap.url);
    expect(await getReceipt(h.deps, seeded.apiKey, id)).toMatchObject({
      status: "found",
      view: { receiptId: id, outcome: "PAID", charged: true },
      followUp: null,
    });

    const sibling = await issueAgentKey(h.deps, seeded.ownerId, seeded.mandateId, {
      name: "sibling",
    });
    const siblingKey = sibling.status === "issued" ? sibling.apiKey : "";
    expect(await getReceipt(h.deps, siblingKey, id)).toMatchObject({ reason: "NOT_FOUND" });
    expect(await getReceipt(h.deps, seeded.apiKey, "nope")).toMatchObject({
      reason: "NOT_FOUND",
    });
    expect(await getReceipt(h.deps, "slip_live_unknown", id)).toMatchObject({
      reason: "UNAUTHENTICATED",
    });
  });

  it("after a revoke the agent can still read what happened; a revoked key cannot", async () => {
    const { h, seeded, buy, cheap } = await setup();
    const id = await buy(cheap.url);
    await h.store.mandates.revoke(seeded.mandateId, h.clock.now());
    expect((await getReceipt(h.deps, seeded.apiKey, id)).status).toBe("found");
    await revokeAgentKey(h.deps, seeded.ownerId, seeded.agentId);
    expect(await getReceipt(h.deps, seeded.apiKey, id)).toMatchObject({
      reason: "UNAUTHENTICATED",
    });
  });

  it("a hold the owner approved without a reservation shows the attempt that paid", async () => {
    const { h, seeded } = await setup();
    const chosen = offer({ price: 250 });
    h.offers.goDown();
    const held = await runCheckout(h.deps, seeded.apiKey, {
      productId: "p2",
      chosenOfferUrl: chosen.url,
      reason: "",
    });
    const id = held.status === "decided" ? held.receipt.attempt.id : "";
    h.offers.comeBack();
    market(h, "p2", [offer({ price: 249 }), chosen]);
    await approveHold(h.deps, seeded.ownerId, id, { expectedAmountCents: 25_000 as Cents });

    const read = await getReceipt(h.deps, seeded.apiKey, id);
    expect(read).toMatchObject({
      status: "found",
      view: {
        outcome: "HELD",
        hold: { status: "APPROVED" },
        // Money moved for this purchase, through the attempt that paid for the hold.
        state: { word: "CAPTURED", charged: true },
      },
      followUp: { view: { outcome: "PAID", ruleCode: "OWNER_APPROVED", charged: true } },
    });
  });
});

describe("getReport", () => {
  it("the agent's own report card, in numbers and words", async () => {
    const { h, seeded, buy, cheap, pricey } = await setup();
    await buy(cheap.url);
    await buy(pricey.url, "p3");
    const read = await getReport(h.deps, seeded.apiKey);
    if (read.status !== "found") {
      throw new Error(JSON.stringify(read));
    }
    expect(read.view.report).toMatchObject({
      agentId: seeded.agentId,
      attempted: 2,
      paid: 1,
      rejected: 1,
      captured: 1,
    });
    expect(read.view.lines[0]).toBe(
      "2 purchases checked: 1 paid, 1 rejected, 0 held for the owner.",
    );
    expect(await getReport(h.deps, "slip_live_unknown")).toMatchObject({
      reason: "UNAUTHENTICATED",
    });
  });
});
