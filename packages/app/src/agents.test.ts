import { randomUUID } from "node:crypto";
import { ownerId } from "@slip/domain";
import { offer } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { harness, market, seedAgent } from "./__fixtures__/harness.js";
import { issueAgentKey, listAgents, revokeAgentKey } from "./agents.js";
import { runCheckout } from "./checkout/checkout.js";

async function setup() {
  const h = harness();
  const seeded = await seedAgent(h);
  const cheap = offer({ price: 10 });
  market(h, "p1", [cheap, offer({ price: 11 })]);
  const buy = (apiKey: string) =>
    runCheckout(h.deps, apiKey, { productId: "p1", chosenOfferUrl: cheap.url, reason: "" });
  return { h, seeded, buy };
}

describe("agent keys", () => {
  it("a new key works at once and is shown only once; the list shows its prefix", async () => {
    const { h, seeded, buy } = await setup();
    const issued = await issueAgentKey(h.deps, seeded.ownerId, seeded.mandateId, {
      name: "  Shopping bot ",
    });
    if (issued.status !== "issued") {
      throw new Error(JSON.stringify(issued));
    }
    expect(issued.agent).toMatchObject({ name: "Shopping bot", mandateId: seeded.mandateId });
    expect((await buy(issued.apiKey)).status).toBe("decided");

    const listed = await listAgents(h.deps, seeded.ownerId, seeded.mandateId);
    expect(listed.status === "listed" && listed.agents.map((a) => a.apiKeyPrefix)).toContain(
      issued.apiKey.slice(0, 14),
    );
    expect(JSON.stringify(listed)).not.toContain(issued.apiKey);
    expect(h.logs.some((l) => JSON.stringify(l).includes(issued.apiKey))).toBe(false);
  });

  it("a revoked key is refused at once; the mandate's other agents carry on", async () => {
    const { h, seeded, buy } = await setup();
    const other = await issueAgentKey(h.deps, seeded.ownerId, seeded.mandateId, { name: "other" });
    expect(await revokeAgentKey(h.deps, seeded.ownerId, seeded.agentId)).toMatchObject({
      status: "revoked",
      agent: { id: seeded.agentId },
    });
    expect(await buy(seeded.apiKey)).toMatchObject({ reason: "UNAUTHENTICATED" });
    expect(other.status === "issued" && (await buy(other.apiKey)).status).toBe("decided");
    expect((await revokeAgentKey(h.deps, seeded.ownerId, seeded.agentId)).status).toBe("revoked");
  });

  it("only the owner manages a mandate's agents", async () => {
    const { h, seeded, buy } = await setup();
    const stranger = ownerId(randomUUID());
    expect(
      await issueAgentKey(h.deps, stranger, seeded.mandateId, { name: "intruder" }),
    ).toMatchObject({ reason: "NOT_FOUND" });
    expect(await revokeAgentKey(h.deps, stranger, seeded.agentId)).toMatchObject({
      reason: "NOT_FOUND",
    });
    expect(await revokeAgentKey(h.deps, seeded.ownerId, "not-a-uuid")).toMatchObject({
      reason: "NOT_FOUND",
    });
    expect(await listAgents(h.deps, stranger, seeded.mandateId)).toMatchObject({
      reason: "NOT_FOUND",
    });
    expect((await buy(seeded.apiKey)).status).toBe("decided");
  });

  it("no key for a revoked mandate, and every agent needs a name", async () => {
    const { h, seeded } = await setup();
    expect(
      await issueAgentKey(h.deps, seeded.ownerId, seeded.mandateId, { name: "   " }),
    ).toMatchObject({ reason: "INVALID_NAME" });
    expect(
      await issueAgentKey(h.deps, seeded.ownerId, seeded.mandateId, { name: "x".repeat(101) }),
    ).toMatchObject({ reason: "INVALID_NAME" });
    await h.store.mandates.revoke(seeded.mandateId, h.clock.now());
    expect(
      await issueAgentKey(h.deps, seeded.ownerId, seeded.mandateId, { name: "late" }),
    ).toMatchObject({ reason: "REVOKED" });
  });
});
