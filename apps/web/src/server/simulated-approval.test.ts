import { completeMandateSetup, registerOwner, startMandate } from "@slip/app";
import { describe, expect, it } from "vitest";
import { demoWorld } from "./demo/__fixtures__/world";
import { approveSimulatedSetup, findSimulatedSetup } from "./simulated-approval";

async function setupFor(world: ReturnType<typeof demoWorld>) {
  const owner = await registerOwner(world.deps, { email: null });
  if (owner.status !== "registered") {
    throw new Error("owner");
  }
  const started = await startMandate(world.deps, owner.owner.id, {});
  if (started.status !== "started") {
    throw new Error("mandate");
  }
  return { ownerId: owner.owner.id, mandateId: started.mandate.id, approveUrl: started.approveUrl };
}

describe("the simulated PayPal approval", () => {
  it("approving saves the method, and the way back activates the mandate", async () => {
    const world = demoWorld();
    const { ownerId, mandateId, approveUrl } = await setupFor(world);
    const reference = decodeURIComponent(approveUrl.split("/").at(-1) ?? "");
    expect(approveUrl.startsWith("http://localhost:3100/demo/paypal/approve/")).toBe(true);
    const found = await findSimulatedSetup(world.deps, ownerId, reference);
    expect(found).toMatchObject({ status: "pending", mandateId });
    expect(
      await approveSimulatedSetup(world.deps, world.fakes.gateway, ownerId, reference),
    ).toMatchObject({ status: "pending", mandateId });
    const back = await completeMandateSetup(world.deps, ownerId as never, mandateId);
    expect(back).toMatchObject({ status: "active" });
    // Once settled, the page says so instead of offering to approve again.
    expect(await findSimulatedSetup(world.deps, ownerId, reference)).toEqual({
      status: "settled",
      mandateId,
    });
  });

  it("someone else's setup, or a made-up reference, is not found", async () => {
    const world = demoWorld();
    const mine = await setupFor(world);
    const theirs = await setupFor(world);
    const reference = decodeURIComponent(theirs.approveUrl.split("/").at(-1) ?? "");
    expect(await findSimulatedSetup(world.deps, mine.ownerId, reference)).toEqual({
      status: "not-found",
    });
    expect(
      await approveSimulatedSetup(world.deps, world.fakes.gateway, mine.ownerId, reference),
    ).toEqual({ status: "not-found" });
    expect(await findSimulatedSetup(world.deps, mine.ownerId, "SETUP-999999")).toEqual({
      status: "not-found",
    });
    // Their setup is untouched: still waiting for its own owner.
    expect(await findSimulatedSetup(world.deps, theirs.ownerId, reference)).toMatchObject({
      status: "pending",
    });
  });
});
