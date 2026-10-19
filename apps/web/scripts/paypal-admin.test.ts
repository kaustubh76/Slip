import { describe, expect, it } from "vitest";
import { planWebhook } from "./paypal-admin";

const EVENTS = ["PAYMENT.CAPTURE.COMPLETED", "VAULT.PAYMENT-TOKEN.CREATED"];
const hook = (id: string, url: string, events = EVENTS) => ({
  id,
  url,
  event_types: events.map((name) => ({ name })),
});

describe("planWebhook", () => {
  it("creates Slip's webhook when the app has none for its route", () => {
    expect(
      planWebhook(
        [hook("WH-1", "https://other.example/hooks")],
        "https://a.trycloudflare.com/api/webhooks/paypal",
        EVENTS,
      ),
    ).toEqual({
      action: "create",
    });
  });

  it("re-points it at a new tunnel, or to new events, keeping its id", () => {
    const ours = hook("WH-2", "https://old.trycloudflare.com/api/webhooks/paypal");
    expect(
      planWebhook([ours], "https://new.trycloudflare.com/api/webhooks/paypal", EVENTS),
    ).toEqual({
      action: "update",
      id: "WH-2",
    });
    expect(
      planWebhook([ours], "https://old.trycloudflare.com/api/webhooks/paypal", [
        ...EVENTS,
        "PAYMENT.CAPTURE.PENDING",
      ]),
    ).toEqual({ action: "update", id: "WH-2" });
  });

  it("leaves it alone when nothing changed", () => {
    const ours = hook("WH-3", "https://same.trycloudflare.com/api/webhooks/paypal");
    expect(
      planWebhook(
        [ours],
        "https://same.trycloudflare.com/api/webhooks/paypal",
        [...EVENTS].reverse(),
      ),
    ).toEqual({
      action: "keep",
      id: "WH-3",
    });
  });
});
