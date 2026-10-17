import { previewApproval } from "@slip/app";
import type { OwnerId } from "@slip/domain";
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
    expect(agents.map((a) => a.name).sort()).toEqual(["shopper-1", "shopper-2"]);
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

  it("scripts what PayPal answers, for that purchase only", async () => {
    const world = demoWorld();
    const desk = await deskOf(world);
    const declined = await consoleErrand(desk, "cheaper", "declines");
    expect(declined.status === "done" && declined.message).toContain("PayPal: FAILED");
  });

  it("a pending payment settles when PayPal is told to finish it", async () => {
    const world = demoWorld();
    const desk = await deskOf(world);
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
