import { PgliteTemplate } from "@slip/db/testing";
import type { Cents, Store } from "@slip/domain";
import { offer } from "@slip/domain/testing";
import {
  AgentCardSchema,
  HoldsSchema,
  MandateSummarySchema,
  PolicyViewSchema,
  ReceiptDetailSchema,
  ReceiptPageSchema,
} from "@slip/receipt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { z } from "zod";
import { type Harness, harness, market, type Seeded, seedAgent } from "../__fixtures__/harness.js";
import { issueAgentKey, revokeAgentKey } from "../agents.js";
import { runCheckout } from "../checkout/checkout.js";
import { approveHold, declineHold } from "../holds.js";
import { updateLimits } from "../mandates.js";
import {
  agentCards,
  listReceipts,
  mandateSummary,
  ownerHolds,
  policyVersions,
  receiptDetail,
} from "./queries.js";

/**
 * The owner's pages read these queries over the wire, and the client checks what it receives
 * against the schemas in `@slip/receipt/schema`. So every result must survive JSON unchanged and
 * parse with its schema — on both stores, for every kind of receipt a page can show.
 */

/** Through JSON and back, then the schema: what a browser would receive and accept. */
function overTheWire<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const wire = JSON.parse(JSON.stringify(value));
  expect(wire).toEqual(value);
  return schema.parse(wire);
}

let product = 0;
async function buy(h: Harness, apiKey: string, offers: ReturnType<typeof offer>[], pick = 0) {
  product += 1;
  const productId = `wire-${product}`;
  market(h, productId, offers);
  const chosen = offers[pick];
  if (chosen === undefined) {
    throw new Error("no such offer");
  }
  const result = await runCheckout(h.deps, apiKey, {
    productId,
    chosenOfferUrl: chosen.url,
    reason: "test",
  });
  if (result.status !== "decided") {
    throw new Error(JSON.stringify(result));
  }
  return result.receipt.attempt.id;
}

describe.each(["memory", "pglite"] as const)("owner reads over the wire (%s store)", (kind) => {
  let template: PgliteTemplate | undefined;
  let close = async () => {};
  let h: Harness;
  let seeded: Seeded;
  const ids: string[] = [];

  beforeAll(async () => {
    let store: Store | undefined;
    if (kind === "pglite") {
      template = await PgliteTemplate.create();
      const fresh = await template.fresh();
      store = fresh.store;
      close = fresh.close;
    }
    h = harness(store === undefined ? {} : { store });
    seeded = await seedAgent(h);
    // Paid at the lowest price.
    ids.push(await buy(h, seeded.apiKey, [offer({ price: 10 }), offer({ price: 11 })]));
    // Rejected: $11 over, and the pricier store pays more commission.
    ids.push(
      await buy(h, seeded.apiKey, [
        offer({ price: 58.99, rate: 0.08 }),
        offer({ price: 47.99, rate: 0.02 }),
        offer({ price: 40, availability: "OutOfStock" }),
      ]),
    );
    // Held above the cap, then approved (captured).
    const approved = await buy(h, seeded.apiKey, [offer({ price: 250 }), offer({ price: 251 })]);
    ids.push(approved);
    await approveHold(h.deps, seeded.ownerId, approved, { expectedAmountCents: 25_000 as Cents });
    // Held with nothing to compare against, then declined (released).
    const declined = await buy(h, seeded.apiKey, [offer({ price: 30 })]);
    ids.push(declined);
    await declineHold(h.deps, seeded.ownerId, declined);
    // Held above the cap, still waiting.
    ids.push(await buy(h, seeded.apiKey, [offer({ price: 300 }), offer({ price: 301 })]));
    // A second version of the limits, and a revoked agent key.
    await updateLimits(h.deps, seeded.ownerId, seeded.mandateId, { orderCapCents: 40_000 });
    const second = await issueAgentKey(h.deps, seeded.ownerId, seeded.mandateId, { name: "spare" });
    if (second.status === "issued") {
      await revokeAgentKey(h.deps, seeded.ownerId, second.agent.id);
    }
    // Migrating a PGlite template takes far longer while every project boots one in `pnpm test`.
  }, 120_000);

  afterAll(async () => {
    await close();
    await template?.close();
  });

  it("the roll", async () => {
    const page = overTheWire(
      ReceiptPageSchema,
      await listReceipts(h.deps, seeded.ownerId, seeded.mandateId),
    );
    expect(page.rows).toHaveLength(5);
  });

  it("every receipt with everything behind it, including the snapshot's offers", async () => {
    for (const id of ids) {
      const detail = overTheWire(
        ReceiptDetailSchema,
        await receiptDetail(h.deps, seeded.ownerId, id),
      );
      expect(detail.offers.length).toBeGreaterThan(0);
      expect(detail.offers.filter((o) => o.chosen)).toHaveLength(1);
    }
  });

  it("the in-tray: the hold still waiting, and the two decided", async () => {
    const holds = overTheWire(
      HoldsSchema,
      await ownerHolds(h.deps, seeded.ownerId, seeded.mandateId),
    );
    expect(holds.pending).toHaveLength(1);
    expect(holds.decided.map((r) => r.view.hold?.status).sort()).toEqual(["APPROVED", "DECLINED"]);
  });

  it("agent cards, the limits' versions and the permission slip", async () => {
    const cards = await agentCards(h.deps, seeded.ownerId, seeded.mandateId);
    expect(cards).toHaveLength(2);
    for (const card of cards ?? []) {
      overTheWire(AgentCardSchema, card);
    }
    const versions = await policyVersions(h.deps, seeded.ownerId, seeded.mandateId);
    expect(versions?.map((p) => overTheWire(PolicyViewSchema, p).version)).toEqual([2, 1]);
    overTheWire(
      MandateSummarySchema,
      await mandateSummary(h.deps, seeded.ownerId, seeded.mandateId),
    );
  });
});
