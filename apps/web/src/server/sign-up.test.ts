import { describe, expect, it, vi } from "vitest";
import { demoWorld } from "./demo/__fixtures__/world";
import { DeskLimiter } from "./demo/desks";
import { startOwner } from "./sign-up";

const SANDBOX = {
  prices: "channel3",
  payment: "sandbox",
  steering: "simulated",
  catalogueSearch: false,
} as const;
const limiter = () => new DeskLimiter({ maxDesks: 100, perAddress: 2, windowMs: 60_000 });

describe("starting as an owner outside the demo", () => {
  it("opens an owner and a permission, and hands back PayPal's approval link", async () => {
    const world = demoWorld();
    const result = await startOwner(world.deps, {
      services: SANDBOX,
      host: "localhost:3100",
      address: "203.0.113.7",
      limiter: limiter(),
    });
    expect(result).toMatchObject({ status: "started" });
    if (result.status !== "started") {
      throw new Error("not started");
    }
    expect(result.approveUrl).toMatch(/\/demo\/paypal\/approve\//);
    const mandate = await world.deps.store.mandates.get(result.mandateId as never);
    expect(mandate).toMatchObject({ status: "PENDING", ownerId: result.ownerId });
  });

  it("is refused where PayPal is live, and for a host that is not Slip's own", async () => {
    const world = demoWorld();
    const base = { host: "localhost:3100", address: "a", limiter: limiter() };
    expect(
      await startOwner(world.deps, { ...base, services: { ...SANDBOX, payment: "live" } }),
    ).toEqual({ status: "refused", reason: "LIVE" });
    for (const host of ["abc.trycloudflare.com", "127.0.0.1:3100", null]) {
      expect(
        await startOwner(world.deps, { ...base, services: SANDBOX, host }),
        String(host),
      ).toEqual({
        status: "refused",
        reason: "FOREIGN_HOST",
      });
    }
  });

  it("opens only a few owners from one address, and says so when PayPal cannot start", async () => {
    const world = demoWorld();
    const shared = limiter();
    const open = () =>
      startOwner(world.deps, {
        services: SANDBOX,
        host: "localhost:3100",
        address: "a",
        limiter: shared,
      });
    await open();
    await open();
    expect(await open()).toEqual({ status: "refused", reason: "SLOW" });

    vi.spyOn(world.fakes.gateway, "startVaultSetup").mockResolvedValue({
      kind: "failed",
      reason: "simulated outage",
    });
    expect(
      await startOwner(world.deps, {
        services: SANDBOX,
        host: "localhost:3100",
        address: "b",
        limiter: limiter(),
      }),
    ).toEqual({ status: "refused", reason: "PAYPAL_UNAVAILABLE" });
  });
});
