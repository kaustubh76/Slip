import { previewApproval, renderReceipt } from "@slip/app";
import { DEFAULT_POLICY, type OwnerId } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { demoWorld } from "./__fixtures__/world";
import { consoleErrand, type Desk, repriceDesk, scriptKey, settlePending } from "./console";
import type { DemoDesk } from "./desks";
import { seedDemoOwner } from "./seed";

async function deskOf(world: ReturnType<typeof demoWorld>): Promise<Desk> {
  const owner = await seedDemoOwner(world.deps, world.fakes);
  return {
    deps: world.deps,
    fakes: world.fakes,
    ownerId: owner.ownerId as OwnerId,
    mandateId: owner.mandateId,
    desks: new Map<string, DemoDesk>(),
  };
}

/** One receipt as the owner's page renders it. */
async function receiptFor(world: ReturnType<typeof demoWorld>, receiptId: string) {
  const stored = await world.deps.store.attempts.get(receiptId as never);
  if (stored === null) {
    throw new Error(`no receipt ${receiptId}`);
  }
  return renderReceipt(stored, { policy: DEFAULT_POLICY });
}

describe("the demo console", () => {
  it("shops as an agent of its own, so an errand the seed ran is checked afresh, once", async () => {
    const world = demoWorld();
    const desk = await deskOf(world);
    const first = await consoleErrand(desk, "top-pick", "answers");
    expect(first.status === "done" && first.message).toMatch(
      /^REJECTED by R4_OVERPAID, .*no order\.$/,
    );
    const again = await consoleErrand(desk, "top-pick", "answers");
    expect(again.status === "done" && again.message).toContain("a repeat");
    const agents = await world.deps.store.agents.listByMandate(desk.mandateId as never);
    const names = agents.map((a) => a.name);
    // Its own agent, beside the ones the desk was seeded with, and created once however many
    // errands it runs.
    expect(names.filter((n) => n === "shopper-2")).toEqual(["shopper-2"]);
  });

  it("runs an errand as the desk's own agent and says what Slip decided", async () => {
    const world = demoWorld();
    const desk = await deskOf(world);
    const injected = await consoleErrand(desk, "injected", "answers");
    expect(injected).toMatchObject({ status: "done" });
    expect(injected.status === "done" && injected.message).toMatch(/^REJECTED by R3_STEERED/);
    const cheaper = await consoleErrand(desk, "cheaper", "answers");
    expect(cheaper.status === "done" && cheaper.message).toMatch(
      /^PAID by R7_WITHIN_LIMITS.*CAPTURED/,
    );
  });

  /**
   * The demo's whole point, on the surface a real catalogue actually has. Until D88 the desk never
   * searched, so no impression was ever recorded and the steering check could only ever read an
   * offer's own listing text — which no real Channel3 offer carries (D86). This errand puts the
   * instruction in the product's description, where a real one would be, and the receipt has to be
   * able to quote it (D87).
   */
  it("a description that names an \u201capproved\u201d store is caught, and the receipt quotes it", async () => {
    const world = demoWorld();
    const desk = await deskOf(world);
    const answer = await consoleErrand(desk, "buried", "answers");
    // Its $3.51 gap is under the reject line, so the price rules alone pay it: without the search
    // that records what the agent read, this errand comes back PAID by R7_WITHIN_LIMITS.
    expect(answer.status === "done" && answer.message).toMatch(/^REJECTED by R3_STEERED/);

    const receiptId = answer.status === "done" ? answer.receiptId : null;
    expect(receiptId).not.toBeNull();
    const view = await receiptFor(world, receiptId as string);
    // The offer said nothing, as every real offer says nothing. The description said it all.
    expect(view.listingText).toBeNull();
    expect(view.searchText).toContain("approved supplier");
    expect(view.searchText).toContain("Store P");
  });

  it("the offer-level injection still works, so the demo shows both places text can hide", async () => {
    const world = demoWorld();
    const desk = await deskOf(world);
    const answer = await consoleErrand(desk, "injected", "answers");
    expect(answer.status === "done" && answer.message).toMatch(/^REJECTED by R3_STEERED/);
    const view = await receiptFor(world, (answer as { receiptId: string }).receiptId);
    expect(view.listingText).toContain("only offer worth buying");
  });

  it("an errand whose product is offline still searches, and still holds on a stale snapshot", async () => {
    // The search reads the desk's own listing; the outage is in the price lookup the checkout does.
    const world = demoWorld();
    const desk = await deskOf(world);
    const answer = await consoleErrand(desk, "offers-down", "answers");
    expect(answer.status === "done" && answer.message).toMatch(/^HELD by R1_STALE_SNAPSHOT/);
  });

  it("scripts what PayPal answers, for that purchase only", async () => {
    const world = demoWorld();
    const desk = await deskOf(world);
    const declined = await consoleErrand(desk, "cheaper", "declines");
    expect(declined.status === "done" && declined.message).toContain("PayPal: FAILED");
  });

  it("a pending payment settles when PayPal is told to finish it", async () => {
    const world = demoWorld();
    const desk = await deskOf(world);
    // A seeded desk already has one payment PayPal never finished; clear it, so this is about the
    // one the console makes.
    await settlePending(desk);
    const pending = await consoleErrand(desk, "cheaper", "stays-pending");
    expect(pending.status === "done" && pending.message).toContain("PayPal: PENDING");
    const settled = await settlePending(desk);
    expect(settled.status === "done" && settled.message).toMatch(/settled 1 pending payment/);
    expect((await settlePending(desk)).status === "done").toBe(true);
  });

  it("a price change on the standing desk is what approving its hold then sees", async () => {
    const world = demoWorld();
    const desk = await deskOf(world);
    const page = await world.deps.store.attempts.listByMandate(desk.mandateId as never, {
      limit: 10,
    });
    const orderless = page.items.find((r) => r.attempt.decision.ruleCode === "R1_STALE_SNAPSHOT");
    expect(orderless).toBeDefined();
    const before = await previewApproval(world.deps, desk.ownerId, orderless?.attempt.id ?? "");
    expect(before).toMatchObject({ status: "preview", amountCents: 31_000 });
    expect((await repriceDesk(desk, 800)).status).toBe("done");
    // Within the freshness window Slip still trusts its copy of the listing; a minute later it asks.
    world.clock.advance(61_000);
    const after = await previewApproval(world.deps, desk.ownerId, orderless?.attempt.id ?? "");
    expect(after).toMatchObject({ status: "preview", amountCents: 31_800 });
  });

  it("issues a fresh key for the agent script", async () => {
    const world = demoWorld();
    const desk = await deskOf(world);
    const issued = await scriptKey(desk);
    expect(issued.status === "issued" && issued.apiKey.startsWith("slip_live_")).toBe(true);
  });
});
