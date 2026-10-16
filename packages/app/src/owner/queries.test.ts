import { randomUUID } from "node:crypto";
import { type Cents, type OwnerId, ownerId } from "@slip/domain";
import { offer } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { type Harness, harness, market, type Seeded, seedAgent } from "../__fixtures__/harness.js";
import { issueAgentKey } from "../agents.js";
import { runCheckout } from "../checkout/checkout.js";
import { approveHold } from "../holds.js";
import { registerOwner, updateLimits } from "../mandates.js";
import {
  agentCard,
  agentCards,
  decodeCursor,
  encodeCursor,
  listReceipts,
  mandateSummary,
  pendingHolds,
  policyVersions,
  receiptDetail,
} from "./queries.js";

let product = 0;

/** An agent checkout for a new product: $10 against $11 pays; $250 against $249 holds. */
async function buy(h: Harness, apiKey: string, kind: "paid" | "held" = "paid") {
  product += 1;
  const productId = `product-${product}`;
  const chosen = offer({ price: kind === "paid" ? 10 : 250 });
  market(h, productId, [
    chosen,
    offer({ price: kind === "paid" ? 11 : 249 }),
    offer({ price: 260 }),
  ]);
  const result = await runCheckout(h.deps, apiKey, {
    productId,
    chosenOfferUrl: chosen.url,
    reason: "",
  });
  if (result.status !== "decided") {
    throw new Error(JSON.stringify(result));
  }
  return result.receipt.attempt.id;
}

async function setup(): Promise<{ h: Harness; seeded: Seeded; stranger: OwnerId }> {
  const h = harness();
  const seeded = await seedAgent(h);
  const other = await seedAgent(h);
  return { h, seeded, stranger: other.ownerId };
}

describe("owner scope", () => {
  it("another owner's mandate, receipt or agent — or a malformed id — is null everywhere", async () => {
    const { h, seeded, stranger } = await setup();
    const id = await buy(h, seeded.apiKey, "held");
    const mandate = seeded.mandateId;
    expect(await listReceipts(h.deps, stranger, mandate)).toBeNull();
    expect(await receiptDetail(h.deps, stranger, id)).toBeNull();
    expect(await pendingHolds(h.deps, stranger, mandate)).toBeNull();
    expect(await agentCards(h.deps, stranger, mandate)).toBeNull();
    expect(await agentCard(h.deps, stranger, seeded.agentId)).toBeNull();
    expect(await policyVersions(h.deps, stranger, mandate)).toBeNull();
    expect(await mandateSummary(h.deps, stranger, mandate)).toBeNull();
    for (const bad of ["", "nope", "../etc"]) {
      expect(await listReceipts(h.deps, seeded.ownerId, bad)).toBeNull();
      expect(await receiptDetail(h.deps, seeded.ownerId, bad)).toBeNull();
      expect(await agentCard(h.deps, seeded.ownerId, bad)).toBeNull();
    }
    // The owner sees all of it.
    expect((await listReceipts(h.deps, seeded.ownerId, mandate))?.rows).toHaveLength(1);
    expect(await receiptDetail(h.deps, seeded.ownerId, id)).not.toBeNull();
  });
});

describe("listReceipts", () => {
  it("pages newest first through receipts made in the same millisecond, each once", async () => {
    const { h, seeded } = await setup();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      ids.add(await buy(h, seeded.apiKey));
    }
    const seen: string[] = [];
    let before: string | null = null;
    do {
      const page = await listReceipts(h.deps, seeded.ownerId, seeded.mandateId, {
        limit: 2,
        before,
      });
      if (page === null) {
        throw new Error("expected a page");
      }
      seen.push(...page.rows.map((r) => r.view.receiptId));
      before = page.next;
    } while (before !== null);
    expect(seen).toHaveLength(5);
    expect(new Set(seen)).toEqual(ids);
    // Equal timestamps fall back to id order, newest (largest) first.
    expect(seen).toEqual([...seen].sort().reverse());
  });

  it("filters to one of the mandate's agents, and names the agent on every row", async () => {
    const { h, seeded } = await setup();
    const second = await issueAgentKey(h.deps, seeded.ownerId, seeded.mandateId, {
      name: "second",
    });
    const secondKey = second.status === "issued" ? second.apiKey : "";
    await buy(h, seeded.apiKey);
    await buy(h, secondKey);
    const all = await listReceipts(h.deps, seeded.ownerId, seeded.mandateId);
    expect(all?.rows.map((r) => r.agent.name).sort()).toEqual(["second", "test agent"]);
    const filtered = await listReceipts(h.deps, seeded.ownerId, seeded.mandateId, {
      agent: second.status === "issued" ? second.agent.id : "",
    });
    expect(filtered?.rows.map((r) => r.agent.name)).toEqual(["second"]);
    // An agent of another mandate is not a filter, it is not found.
    const other = await seedAgent(h);
    expect(
      await listReceipts(h.deps, seeded.ownerId, seeded.mandateId, { agent: other.agentId }),
    ).toBeNull();
  });

  it("each receipt is read under the limits it was decided with", async () => {
    const { h, seeded } = await setup();
    await buy(h, seeded.apiKey, "held");
    await updateLimits(h.deps, seeded.ownerId, seeded.mandateId, { orderCapCents: 30_000 });
    const [row] = (await listReceipts(h.deps, seeded.ownerId, seeded.mandateId))?.rows ?? [];
    expect(row?.view).toMatchObject({
      policyVersion: 1,
      verdict: "$250.00 is above your $200.00 order cap. Held for you.",
    });
    const versions = await policyVersions(h.deps, seeded.ownerId, seeded.mandateId);
    expect(versions?.map((p) => [p.version, p.orderCapCents])).toEqual([
      [2, 30_000],
      [1, 20_000],
    ]);
  });

  it("a cursor that is not one gives the first page", () => {
    const cursor = { createdAt: new Date("2026-10-11T14:02:00Z"), id: randomUUID() };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    for (const bad of [
      undefined,
      null,
      "",
      "garbage",
      Buffer.from("x|y|z").toString("base64url"),
    ]) {
      expect(decodeCursor(bad)).toBeUndefined();
    }
  });
});

describe("receiptDetail", () => {
  it("puts the other comparable offers on the scale and lists the payment's moves", async () => {
    const { h, seeded } = await setup();
    const id = await buy(h, seeded.apiKey);
    const detail = await receiptDetail(h.deps, seeded.ownerId, id);
    expect(detail?.agent.name).toBe("test agent");
    // The $10.00 choice is also the lowest; the $11.00 and $260.00 offers are the ticks.
    expect(detail?.view.measure?.ticks.map((t) => t.cents)).toEqual([1_100, 26_000]);
    expect(detail?.timeline.map((t) => t.to)).toEqual(["INITIATED", "CAPTURED"]);
    expect(detail?.parent).toBeNull();
    expect(detail?.followUp).toBeNull();
  });

  it("links an approved hold and the attempt that paid for it, both ways", async () => {
    const { h, seeded } = await setup();
    h.offers.goDown();
    const held = await buy(h, seeded.apiKey, "held");
    h.offers.comeBack();
    const chosenUrl = (await h.store.attempts.get(held as never))?.attempt.chosenOfferUrl ?? "";
    market(h, `product-${product}`, [offer({ price: 249 }), offer({ price: 250, url: chosenUrl })]);
    const approved = await approveHold(h.deps, seeded.ownerId, held, {
      expectedAmountCents: 25_000 as Cents,
    });
    const childId = approved.status === "done" ? approved.followUp?.receipt.attempt.id : undefined;
    const parent = await receiptDetail(h.deps, seeded.ownerId, held);
    expect(parent?.followUp?.receiptId).toBe(childId);
    expect(parent?.view.state).toMatchObject({ word: "CAPTURED", charged: true });
    const child = await receiptDetail(h.deps, seeded.ownerId, childId ?? "");
    expect(child?.parent?.receiptId).toBe(held);
  });
});

describe("holds, agents and the mandate", () => {
  it("waiting holds come soonest-to-expire first", async () => {
    const { h, seeded } = await setup();
    const first = await buy(h, seeded.apiKey, "held");
    h.clock.advance(60 * 60_000);
    const second = await buy(h, seeded.apiKey, "held");
    const holds = await pendingHolds(h.deps, seeded.ownerId, seeded.mandateId);
    expect(holds?.map((r) => r.view.receiptId)).toEqual([first, second]);
  });

  it("agent cards carry the report and the key's prefix, never the key", async () => {
    const { h, seeded } = await setup();
    await buy(h, seeded.apiKey);
    const cards = await agentCards(h.deps, seeded.ownerId, seeded.mandateId);
    expect(cards).toHaveLength(1);
    expect(cards?.[0]?.agent.apiKeyPrefix).toBe(seeded.apiKey.slice(0, 14));
    expect(cards?.[0]?.report.lines[0]).toBe(
      "1 purchase checked: 1 paid, 0 rejected, 0 held for the owner.",
    );
    expect(JSON.stringify(cards)).not.toContain(seeded.apiKey);
    expect((await agentCard(h.deps, seeded.ownerId, seeded.agentId))?.agent.name).toBe(
      "test agent",
    );
  });

  it("the mandate summary counts what is waiting", async () => {
    const { h, seeded } = await setup();
    await buy(h, seeded.apiKey, "held");
    expect(await mandateSummary(h.deps, seeded.ownerId, seeded.mandateId)).toMatchObject({
      status: "ACTIVE",
      awaitingPayPal: false,
      hasSavedMethod: true,
      policyVersion: 1,
      pendingHolds: 1,
      agents: 1,
      revokedAt: null,
    });
  });
});

describe("registerOwner", () => {
  it("records an owner, with or without an email, each email once", async () => {
    const h = harness();
    const first = await registerOwner(h.deps, { email: "  Owner@Example.com " });
    expect(first).toMatchObject({ status: "registered", owner: { email: "owner@example.com" } });
    expect(await registerOwner(h.deps, { email: "owner@example.com" })).toMatchObject({
      reason: "EMAIL_IN_USE",
    });
    expect(await registerOwner(h.deps, { email: "not an email" })).toMatchObject({
      reason: "INVALID_EMAIL",
    });
    expect(await registerOwner(h.deps, { email: null })).toMatchObject({
      status: "registered",
      owner: { email: null },
    });
    const id = first.status === "registered" ? first.owner.id : ownerId(randomUUID());
    expect(await h.store.owners.get(id)).not.toBeNull();
  });
});
