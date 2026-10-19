import { describe, expect, it } from "vitest";
import { demoWorld } from "./demo/__fixtures__/world";
import { handlePayPalWebhook } from "./paypal-webhook";

const URL_ = "http://localhost:3000/api/webhooks/paypal";

function delivery(request: { headers: Record<string, string | undefined>; rawBody: string }) {
  const headers = new Headers({ "content-type": "application/json" });
  for (const [name, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return new Request(URL_, { method: "POST", headers, body: request.rawBody });
}

describe("PayPal's webhook deliveries", () => {
  it("a verified delivery is applied once; its redelivery is acknowledged without effect", async () => {
    const world = demoWorld();
    const event = world.inner.webhook({ kind: "ignored", eventType: "CHECKOUT.ORDER.APPROVED" });
    const first = await handlePayPalWebhook(world.deps, delivery(event.request));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "processed" });
    const again = await handlePayPalWebhook(world.deps, delivery(event.request));
    expect(await again.json()).toEqual({ status: "duplicate" });
    expect(again.headers.get("cache-control")).toBe("no-store");
  });

  it("a delivery PayPal did not sign is refused with a 400, and nothing is stored", async () => {
    const world = demoWorld();
    const forged = world.inner.webhook(
      { kind: "ignored", eventType: "CHECKOUT.ORDER.APPROVED" },
      { signed: false },
    );
    const response = await handlePayPalWebhook(world.deps, delivery(forged.request));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ status: "rejected", reason: "BAD_SIGNATURE" });
    // Nothing was stored: the genuine delivery of the same event is new, not a duplicate.
    const genuine = world.inner.webhook(
      { kind: "ignored", eventType: "CHECKOUT.ORDER.APPROVED" },
      { id: forged.id },
    );
    expect(await (await handlePayPalWebhook(world.deps, delivery(genuine.request))).json()).toEqual(
      { status: "processed" },
    );
  });

  it("refuses a body no PayPal event comes near, before verifying anything", async () => {
    const world = demoWorld();
    const event = world.inner.webhook({ kind: "ignored", eventType: "X" });
    const big = { ...event.request, rawBody: "x".repeat(2_000) };
    const response = await handlePayPalWebhook(world.deps, delivery(big), 1_000);
    expect(response.status).toBe(413);
    expect(world.inner.callsTo("verifyWebhook")).toHaveLength(0);
  });
});
