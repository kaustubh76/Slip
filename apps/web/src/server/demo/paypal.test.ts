import type { AttemptId, MandateId, RequestId } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { demoWorld } from "./__fixtures__/world";
import { runErrand } from "./desk";
import { seedDemoOwner } from "./seed";

const uuid = () => crypto.randomUUID();

describe("DemoPayPal", () => {
  it("an outcome forced on one desk reaches that desk's purchase only", async () => {
    const { deps, fakes } = demoWorld();
    const [a, b] = await Promise.all([seedDemoOwner(deps, fakes), seedDemoOwner(deps, fakes)]);
    const [declined, paid] = await Promise.all([
      runErrand(deps, fakes, a, "cheaper", { order: "decline" }),
      runErrand(deps, fakes, b, "cheaper"),
    ]);
    expect(declined.status === "decided" && declined.receipt.payment?.status).toBe("FAILED");
    expect(paid.status === "decided" && paid.receipt.payment?.status).toBe("CAPTURED");
  });

  it("an outcome the purchase never used is dropped, not left for the next one", async () => {
    const { deps, fakes } = demoWorld();
    const desk = await seedDemoOwner(deps, fakes);
    // A refused purchase never reaches PayPal, so the forced decline goes unused…
    const rejected = await runErrand(deps, fakes, desk, "injected", { order: "decline" });
    expect(rejected.status === "decided" && rejected.receipt.attempt.decision.ruleCode).toBe(
      "R3_STEERED",
    );
    // …and the desk's next purchase is paid normally.
    const paid = await runErrand(deps, fakes, desk, "cheaper");
    expect(paid.status === "decided" && paid.receipt.payment?.status).toBe("CAPTURED");
  });

  it("each desk's call log shows its own PayPal calls, with PayPal's answer", async () => {
    const { deps, fakes } = demoWorld();
    const [a, b] = await Promise.all([seedDemoOwner(deps, fakes), seedDemoOwner(deps, fakes)]);
    const mine = new Set(
      (await deps.store.attempts.listByMandate(a.mandateId as MandateId, { limit: 50 })).items.map(
        (r) => r.attempt.id as string,
      ),
    );
    const calls = fakes.gateway.callsFor(a.mandateId);
    // The seed paid one purchase and reserved one: two orders on this desk.
    expect(calls.map((c) => [c.call, c.detail, c.answer])).toEqual(
      expect.arrayContaining([
        ["order", "CAPTURE $31.50", "captured"],
        ["order", "AUTHORIZE $239.00", "authorized"],
      ]),
    );
    expect(calls.every((c) => c.attemptId !== null && mine.has(c.attemptId))).toBe(true);
    expect(fakes.gateway.callsFor(b.mandateId)).toHaveLength(2);
  });

  it("points approval links at Slip's own simulated approval page", async () => {
    const { fakes } = demoWorld();
    const started = await fakes.gateway.startVaultSetup(
      {
        mandateId: uuid() as MandateId,
        requestId: uuid() as RequestId,
        returnUrl: "http://localhost:3100/return",
        cancelUrl: "http://localhost:3100/cancel",
      },
      new AbortController().signal,
    );
    expect(started.kind).toBe("started");
    if (started.kind === "started") {
      expect(started.approveUrl).toBe(
        `http://localhost:3100/demo/paypal/approve/${encodeURIComponent(started.reference)}`,
      );
    }
  });

  it("a money call takes its time, and a deadline that passes meanwhile sends nothing", async () => {
    const { fakes, inner, clock } = demoWorld({ latencyMs: 2_000 });
    const order = (signal: AbortSignal) =>
      fakes.gateway.createOrder(
        {
          intent: "CAPTURE",
          vaultId: "VAULT-none",
          amountCents: 1_000 as never,
          requestId: uuid() as RequestId,
          invoiceId: uuid() as AttemptId,
          description: "test",
        },
        signal,
      );
    let settled = false;
    const slow = order(new AbortController().signal).then((r) => {
      settled = true;
      return r;
    });
    // The call looks its attempt up first, then waits on the clock.
    while (clock.sleeping === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(settled).toBe(false);
    clock.advance(2_000);
    expect((await slow).kind).toBe("declined");

    const deadline = new AbortController();
    const cut = order(deadline.signal);
    deadline.abort();
    expect(await cut).toMatchObject({ kind: "unknown" });
    // Only the first call reached PayPal.
    expect(inner.orders()).toHaveLength(1);
  });
});
