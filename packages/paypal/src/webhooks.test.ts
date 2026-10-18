import type { Fetch } from "@slip/http";
import { describe, expect, it } from "vitest";
import { createPayPalApi } from "./client.js";
import { createWebhookOperations, interpretWebhook } from "./webhooks.js";

/**
 * Verification is a call PayPal must answer SUCCESS; interpretation is pure. The deliveries below
 * are PayPal's documented v2 payloads: the resource is the capture or authorization itself.
 */

const live = () => new AbortController().signal;

const headers = (over: Record<string, string | undefined> = {}) => ({
  "paypal-auth-algo": "SHA256withRSA",
  "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-abc",
  "paypal-transmission-id": "t-1",
  "paypal-transmission-sig": "sig-1",
  "paypal-transmission-time": "2026-10-18T10:00:00Z",
  ...over,
});

function stub(answer: Response | Error) {
  const sent: { url: string; body: string }[] = [];
  const fetch = (async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const url = String(input);
    sent.push({ url, body: String(init?.body ?? "") });
    if (url.endsWith("/v1/oauth2/token")) {
      return new Response(JSON.stringify({ access_token: "A", expires_in: 100 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  }) as Fetch;
  return { fetch, sent };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const webhooks = (answer: Response | Error) => {
  const { fetch, sent } = stub(answer);
  return {
    sent,
    paypal: createWebhookOperations(
      createPayPalApi({ clientId: "client", clientSecret: "secret", fetch }),
      { webhookId: "WH-SUB-1" },
    ),
    verifyCall: () => sent.find((call) => call.url.includes("verify-webhook-signature")),
  };
};

describe("verifying a delivery", () => {
  const rawBody = '{"id":"WH-1","event_type":"PAYMENT.CAPTURE.COMPLETED","resource":{"id":"CAP"}}';

  it("sends the five signed headers, the subscription, and the body untouched", async () => {
    const { paypal, verifyCall } = webhooks(json(200, { verification_status: "SUCCESS" }));
    expect(await paypal.verifyWebhook({ headers: headers(), rawBody }, live())).toBe(true);
    const body = verifyCall()?.body ?? "";
    // Spliced in verbatim: re-encoding the JSON would change bytes PayPal signed.
    expect(body).toContain(`"webhook_event":${rawBody}`);
    expect(body).toContain('"webhook_id":"WH-SUB-1"');
    expect(JSON.parse(body)).toMatchObject({
      auth_algo: "SHA256withRSA",
      cert_url: "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-abc",
      transmission_id: "t-1",
      transmission_sig: "sig-1",
      transmission_time: "2026-10-18T10:00:00Z",
    });
  });

  it("reads header names in any case", async () => {
    const { paypal } = webhooks(json(200, { verification_status: "SUCCESS" }));
    const mixed = {
      "PayPal-Auth-Algo": "SHA256withRSA",
      "PayPal-Cert-Url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-abc",
      "PayPal-Transmission-Id": "t-1",
      "PayPal-Transmission-Sig": "sig-1",
      "PayPal-Transmission-Time": "2026-10-18T10:00:00Z",
    };
    expect(await paypal.verifyWebhook({ headers: mixed, rawBody }, live())).toBe(true);
  });

  it("is false when PayPal says FAILURE", async () => {
    const { paypal } = webhooks(json(200, { verification_status: "FAILURE" }));
    expect(await paypal.verifyWebhook({ headers: headers(), rawBody }, live())).toBe(false);
  });

  it.each([
    ["paypal-transmission-sig"],
    ["paypal-transmission-id"],
    ["paypal-cert-url"],
    ["paypal-auth-algo"],
    ["paypal-transmission-time"],
  ])("a delivery missing %s is not verified, and PayPal is not even asked", async (missing) => {
    const { paypal, verifyCall } = webhooks(json(200, { verification_status: "SUCCESS" }));
    const incomplete = { ...headers(), [missing]: undefined };
    expect(await paypal.verifyWebhook({ headers: incomplete, rawBody }, live())).toBe(false);
    expect(verifyCall()).toBeUndefined();
  });

  it("a body that is not JSON is not verified, and never spliced into ours", async () => {
    const { paypal, verifyCall } = webhooks(json(200, { verification_status: "SUCCESS" }));
    expect(await paypal.verifyWebhook({ headers: headers(), rawBody: '{"a":1' }, live())).toBe(
      false,
    );
    expect(verifyCall()).toBeUndefined();
  });

  it.each([[400], [401], [500]])(
    "a %i from the check is not a verified delivery",
    async (status) => {
      const { paypal } = webhooks(json(status, { name: "INVALID_REQUEST" }));
      expect(await paypal.verifyWebhook({ headers: headers(), rawBody }, live())).toBe(false);
    },
  );

  it("a check Slip could not complete is not a verified delivery", async () => {
    const { paypal } = webhooks(new TypeError("fetch failed"));
    expect(await paypal.verifyWebhook({ headers: headers(), rawBody }, live())).toBe(false);
  });
});

describe("reading a verified delivery", () => {
  const delivery = (eventType: string, resource: Record<string, unknown>) => ({
    id: "WH-1",
    event_type: eventType,
    resource,
  });

  const capture = {
    id: "7X550106NA4440028",
    status: "COMPLETED",
    custom_id: "11111111-1111-4111-8111-111111111111",
    invoice_id: "11111111-1111-4111-8111-111111111111",
    supplementary_data: { related_ids: { order_id: "8K832279M55989614" } },
  };

  it("a completed capture carries the attempt, the order and the capture", () => {
    expect(interpretWebhook(delivery("PAYMENT.CAPTURE.COMPLETED", capture))).toEqual({
      kind: "capture-completed",
      attemptId: "11111111-1111-4111-8111-111111111111",
      orderId: "8K832279M55989614",
      captureId: "7X550106NA4440028",
    });
  });

  it("a pending capture is its own event, not a completed one", () => {
    expect(interpretWebhook(delivery("PAYMENT.CAPTURE.PENDING", capture))).toMatchObject({
      kind: "capture-pending",
      captureId: "7X550106NA4440028",
    });
  });

  it.each([["PAYMENT.CAPTURE.DENIED"], ["PAYMENT.CAPTURE.DECLINED"]])(
    "%s is a declined capture, whichever name PayPal uses",
    (eventType) => {
      expect(
        interpretWebhook(
          delivery(eventType, {
            ...capture,
            status: "DECLINED",
            status_details: { reason: "DECLINED_BY_RISK_FRAUD_FILTERS" },
          }),
        ),
      ).toEqual({
        kind: "capture-declined",
        attemptId: "11111111-1111-4111-8111-111111111111",
        captureId: "7X550106NA4440028",
        reason: "DECLINED_BY_RISK_FRAUD_FILTERS",
      });
    },
  );

  it("an authorization created and an authorization voided", () => {
    const authorization = {
      id: "0VF52814937998046",
      custom_id: "11111111-1111-4111-8111-111111111111",
      supplementary_data: { related_ids: { order_id: "8K832279M55989614" } },
    };
    expect(interpretWebhook(delivery("PAYMENT.AUTHORIZATION.CREATED", authorization))).toEqual({
      kind: "authorization-created",
      attemptId: "11111111-1111-4111-8111-111111111111",
      orderId: "8K832279M55989614",
      authorizationId: "0VF52814937998046",
    });
    expect(interpretWebhook(delivery("PAYMENT.AUTHORIZATION.VOIDED", authorization))).toEqual({
      kind: "authorization-voided",
      attemptId: "11111111-1111-4111-8111-111111111111",
      authorizationId: "0VF52814937998046",
    });
  });

  it("a vault token created is how a deferred vault id arrives", () => {
    expect(
      interpretWebhook(
        delivery("VAULT.PAYMENT-TOKEN.CREATED", {
          id: "jwgvx42",
          customer: { id: "customer_1" },
          metadata: { setup_token_id: "4G4976650J0948357" },
        }),
      ),
    ).toEqual({
      kind: "vault-token-created",
      vaultId: "jwgvx42",
      customerId: "customer_1",
      setupReference: "4G4976650J0948357",
    });
  });

  it("a vault token deleted names only the token", () => {
    expect(interpretWebhook(delivery("VAULT.PAYMENT-TOKEN.DELETED", { id: "jwgvx42" }))).toEqual({
      kind: "vault-token-deleted",
      vaultId: "jwgvx42",
    });
  });

  it.each([
    ["PAYMENT.CAPTURE.REFUNDED"],
    ["CHECKOUT.ORDER.APPROVED"],
    ["CUSTOMER.DISPUTE.CREATED"],
  ])("%s is ignored: a real event Slip has no rule for", (eventType) => {
    expect(interpretWebhook(delivery(eventType, capture))).toEqual({
      kind: "ignored",
      eventType,
    });
  });

  it("a payment event with no attempt id on it is ignored, never guessed at", () => {
    // `custom_id` is how PayPal echoes the attempt. Without it there is nothing to apply this to.
    const { custom_id: _, ...anonymous } = capture;
    expect(interpretWebhook(delivery("PAYMENT.CAPTURE.COMPLETED", anonymous))).toEqual({
      kind: "ignored",
      eventType: "PAYMENT.CAPTURE.COMPLETED",
    });
  });

  it.each([[null], [undefined], ["nope"], [42], [[]], [{}], [{ event_type: 7 }]])(
    "anything that is not a delivery is ignored: %s",
    (payload) => {
      expect(interpretWebhook(payload)).toMatchObject({ kind: "ignored" });
    },
  );

  it("is pure: the same payload reads the same way twice", () => {
    const payload = delivery("PAYMENT.CAPTURE.COMPLETED", capture);
    expect(interpretWebhook(payload)).toEqual(interpretWebhook(payload));
  });
});
