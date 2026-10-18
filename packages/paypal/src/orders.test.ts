import { type AttemptId, attemptId, type Cents, type RequestId, requestId } from "@slip/domain";
import type { Fetch } from "@slip/http";
import { beforeEach, describe, expect, it } from "vitest";
import { createPayPalApi, PAYPAL_SANDBOX_BASE_URL } from "./client.js";
import { createOrderOperations } from "./orders.js";

/**
 * The money operations against recorded PayPal responses, with `fetch` injected. The request
 * assertions are exact — path, `PayPal-Request-Id`, `stored_credential`, the amount as a string —
 * because a wrong field here is a payment that does not happen, or happens twice.
 */

const AMOUNT = 1299 as Cents;
const INVOICE = attemptId("11111111-1111-4111-8111-111111111111") as AttemptId;
const REQUEST = requestId("22222222-2222-4222-8222-222222222222") as RequestId;
const live = () => new AbortController().signal;

const token = { access_token: "A-TOKEN", token_type: "Bearer", expires_in: 32_400 };

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Answer = Response | Error;

/** A `fetch` that answers the token call, then each later call from `answers` in turn. */
function stub(...answers: Answer[]) {
  const sent: Sent[] = [];
  const queue = [...answers];
  const fetch = (async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const url = String(input);
    const raw = init?.body;
    sent.push({
      url,
      method: String(init?.method ?? "GET"),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : (raw ?? null),
    });
    if (url.endsWith("/v1/oauth2/token")) {
      return json(200, token);
    }
    const answer = queue.shift() ?? json(200, {});
    if (answer instanceof Error) {
      throw answer;
    }
    return answer;
  }) as Fetch;
  return { fetch, sent };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const error = (status: number, ...issues: string[]) =>
  json(status, {
    name: status === 422 ? "UNPROCESSABLE_ENTITY" : "INVALID_REQUEST",
    message: "The requested action could not be performed.",
    debug_id: "d-1234",
    details: issues.map((issue) => ({ issue, description: "free text from PayPal" })),
  });

/** The documented answer to Slip's own request: a vaulted wallet, charged with nobody present. */
const order = (over: Record<string, unknown> = {}) => ({
  id: "8K832279M55989614",
  intent: "CAPTURE",
  status: "COMPLETED",
  purchase_units: [
    {
      amount: { currency_code: "USD", value: "12.99" },
      payments: {
        captures: [{ id: "7X550106NA4440028", status: "COMPLETED", amount: { value: "12.99" } }],
      },
    },
  ],
  ...over,
});

const authorizedOrder = (status = "CREATED", over: Record<string, unknown> = {}) => ({
  id: "8K832279M55989614",
  intent: "AUTHORIZE",
  status: "COMPLETED",
  purchase_units: [
    { payments: { authorizations: [{ id: "0VF52814937998046", status, ...over }] } },
  ],
});

const operations = (...answers: Answer[]) => {
  const { fetch, sent } = stub(...answers);
  return {
    sent,
    paypal: createOrderOperations(
      createPayPalApi({ clientId: "client", clientSecret: "secret", fetch }),
    ),
    /** The calls that were not the token request. */
    calls: () => sent.filter((call) => !call.url.endsWith("/v1/oauth2/token")),
  };
};

const createInput = {
  intent: "CAPTURE" as const,
  vaultId: "2w915838hr181240m",
  amountCents: AMOUNT,
  requestId: REQUEST,
  invoiceId: INVOICE,
  description: "Trail shoe from store-b.example",
};

describe("the access token", () => {
  it("is asked for once and then reused", async () => {
    const { paypal, sent } = operations(json(200, order()), json(200, order()));
    await paypal.createOrder(createInput, live());
    await paypal.createOrder(createInput, live());
    const tokens = sent.filter((call) => call.url.endsWith("/v1/oauth2/token"));
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.method).toBe("POST");
    expect(tokens[0]?.body).toBe("grant_type=client_credentials");
    // Basic base64("client:secret"), which is what PayPal authenticates the token call with.
    expect(tokens[0]?.headers["authorization"]).toBe(`Basic ${btoa("client:secret")}`);
  });

  it("is asked for again once it has expired", async () => {
    let clock = 0;
    const { fetch, sent } = stub(json(200, order()), json(200, order()));
    const paypal = createOrderOperations(
      createPayPalApi({
        clientId: "client",
        clientSecret: "secret",
        fetch,
        now: () => clock,
      }),
    );
    await paypal.createOrder(createInput, live());
    clock = 32_400 * 1_000;
    await paypal.createOrder(createInput, live());
    expect(sent.filter((call) => call.url.endsWith("/v1/oauth2/token"))).toHaveLength(2);
  });

  it("a token Slip cannot get is unknown, never a decline", async () => {
    const { fetch } = stub();
    const failing = (async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
      if (String(input).endsWith("/v1/oauth2/token")) {
        return json(401, { error: "invalid_client" });
      }
      return fetch(input, init as RequestInit);
    }) as Fetch;
    const paypal = createOrderOperations(
      createPayPalApi({ clientId: "client", clientSecret: "wrong", fetch: failing }),
    );
    expect(await paypal.createOrder(createInput, live())).toMatchObject({ kind: "unknown" });
  });
});

describe("creating an order", () => {
  it("asks for exactly the charge Slip means: a vaulted wallet, nobody present", async () => {
    const { paypal, calls } = operations(json(200, order()));
    await paypal.createOrder(createInput, live());
    const call = calls()[0];
    expect(call?.url).toBe(`${PAYPAL_SANDBOX_BASE_URL}/v2/checkout/orders`);
    expect(call?.method).toBe("POST");
    expect(call?.headers["paypal-request-id"]).toBe(REQUEST);
    expect(call?.headers["prefer"]).toBe("return=representation");
    expect(call?.headers["authorization"]).toBe("Bearer A-TOKEN");
    expect(call?.body).toEqual({
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: { currency_code: "USD", value: "12.99" },
          invoice_id: INVOICE,
          custom_id: INVOICE,
          description: "Trail shoe from store-b.example",
        },
      ],
      payment_source: {
        paypal: {
          vault_id: "2w915838hr181240m",
          stored_credential: {
            payment_initiator: "MERCHANT",
            usage: "SUBSEQUENT",
            usage_pattern: "UNSCHEDULED_POSTPAID",
          },
        },
      },
    });
  });

  it("truncates a description to PayPal's limit rather than being refused", async () => {
    const { paypal, calls } = operations(json(200, order()));
    await paypal.createOrder({ ...createInput, description: "x".repeat(400) }, live());
    const body = calls()[0]?.body as { purchase_units: { description: string }[] } | undefined;
    expect(body?.purchase_units[0]?.description).toHaveLength(127);
  });

  it("sends no description at all rather than an empty one", async () => {
    const { paypal, calls } = operations(json(200, order()));
    await paypal.createOrder({ ...createInput, description: "   " }, live());
    expect(calls()[0]?.body).toMatchObject({ purchase_units: [{ invoice_id: INVOICE }] });
    expect(JSON.stringify(calls()[0]?.body)).not.toContain("description");
  });

  it("reads a one-step charge as captured", async () => {
    const { paypal } = operations(json(201, order()));
    expect(await paypal.createOrder(createInput, live())).toEqual({
      kind: "captured",
      orderId: "8K832279M55989614",
      captureId: "7X550106NA4440028",
    });
  });

  it("reads a hold as authorized", async () => {
    const { paypal } = operations(json(201, authorizedOrder()));
    expect(await paypal.createOrder({ ...createInput, intent: "AUTHORIZE" }, live())).toEqual({
      kind: "authorized",
      orderId: "8K832279M55989614",
      authorizationId: "0VF52814937998046",
    });
  });

  it("reads a capture PayPal has not finished as pending", async () => {
    const { paypal } = operations(
      json(
        201,
        order({
          purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "PENDING" }] } }],
        }),
      ),
    );
    expect(await paypal.createOrder(createInput, live())).toEqual({
      kind: "pending",
      orderId: "8K832279M55989614",
      captureId: "CAP-1",
      authorizationId: null,
    });
  });

  it("reads a declined capture as declined, with the order to look at", async () => {
    const { paypal } = operations(
      json(
        201,
        order({
          purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "DECLINED" }] } }],
        }),
      ),
    );
    expect(await paypal.createOrder(createInput, live())).toMatchObject({
      kind: "declined",
      orderId: "8K832279M55989614",
      reason: "CAPTURE_DECLINED",
    });
  });

  it("sends the owner back to PayPal when the vaulted method needs them again", async () => {
    const { paypal } = operations(
      json(201, {
        id: "ORDER-1",
        status: "PAYER_ACTION_REQUIRED",
        links: [
          { rel: "self", href: "https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1" },
          { rel: "payer-action", href: "https://www.sandbox.paypal.com/agreements/approve?ba=1" },
        ],
      }),
    );
    expect(await paypal.createOrder(createInput, live())).toEqual({
      kind: "payer-action-required",
      orderId: "ORDER-1",
      approveUrl: "https://www.sandbox.paypal.com/agreements/approve?ba=1",
    });
  });

  it("a refused second order for one attempt is duplicate-invoice, never a failure", async () => {
    const { paypal } = operations(error(422, "DUPLICATE_INVOICE_ID"));
    const result = await paypal.createOrder(createInput, live());
    // The caller looks the first order up; treating this as a failure would lose a real payment.
    expect(result.kind).toBe("duplicate-invoice");
  });

  it.each([
    ["INSTRUMENT_DECLINED"],
    ["PAYER_CANNOT_PAY"],
    ["MISMATCHED_VAULT_ID_TO_PAYMENT_SOURCE"],
  ])("%s is a decline: nothing was held and nothing taken", async (issue) => {
    const { paypal } = operations(error(422, issue));
    expect(await paypal.createOrder(createInput, live())).toMatchObject({ kind: "declined" });
  });

  it.each([[400], [403], [429], [500], [503]])(
    "a %i is unknown: the order may or may not exist",
    async (status) => {
      const { paypal } = operations(error(status, "INTERNAL_SERVER_ERROR"));
      expect(await paypal.createOrder(createInput, live())).toMatchObject({ kind: "unknown" });
    },
  );

  it("a deadline reached mid-call is unknown", async () => {
    const aborted = new Error("aborted");
    aborted.name = "AbortError";
    const { paypal } = operations(aborted);
    expect(await paypal.createOrder(createInput, live())).toMatchObject({ kind: "unknown" });
  });

  it("an unreachable PayPal is unknown, with the reason kept", async () => {
    const down = new TypeError("fetch failed");
    down.cause = { code: "ECONNRESET" };
    const { paypal } = operations(down);
    const result = await paypal.createOrder(createInput, live());
    expect(result).toMatchObject({ kind: "unknown" });
    expect(result.kind === "unknown" && result.reason).toContain("ECONNRESET");
  });

  it("does not call PayPal at all once the deadline has passed", async () => {
    const controller = new AbortController();
    controller.abort();
    const { paypal, sent } = operations(json(200, order()));
    expect(await paypal.createOrder(createInput, controller.signal)).toMatchObject({
      kind: "unknown",
    });
    expect(sent).toEqual([]);
  });

  it("never retries — one order out, one call made", async () => {
    const { paypal, calls } = operations(error(500, "INTERNAL_SERVER_ERROR"));
    await paypal.createOrder(createInput, live());
    expect(calls()).toHaveLength(1);
  });
});

describe("capturing a hold", () => {
  const captureInput = {
    authorizationId: "0VF52814937998046",
    amountCents: AMOUNT,
    requestId: REQUEST,
    invoiceId: INVOICE,
    finalCapture: true as const,
  };

  it("captures the hold once, in full, under the capture's own request id", async () => {
    const { paypal, calls } = operations(json(201, { id: "CAP-9", status: "COMPLETED" }));
    expect(await paypal.captureAuthorization(captureInput, live())).toEqual({
      kind: "captured",
      captureId: "CAP-9",
    });
    const call = calls()[0];
    expect(call?.url).toBe(
      `${PAYPAL_SANDBOX_BASE_URL}/v2/payments/authorizations/0VF52814937998046/capture`,
    );
    expect(call?.headers["paypal-request-id"]).toBe(REQUEST);
    expect(call?.body).toEqual({
      amount: { currency_code: "USD", value: "12.99" },
      invoice_id: INVOICE,
      final_capture: true,
    });
  });

  it("a capture PayPal has not settled is pending, with its id recorded", async () => {
    const { paypal } = operations(json(201, { id: "CAP-9", status: "PENDING" }));
    expect(await paypal.captureAuthorization(captureInput, live())).toEqual({
      kind: "pending",
      captureId: "CAP-9",
    });
  });

  it.each([["AUTHORIZATION_VOIDED"], ["AUTHORIZATION_EXPIRED"], ["INSTRUMENT_DECLINED"]])(
    "%s is declined: the money is not coming",
    async (issue) => {
      const { paypal } = operations(error(422, issue));
      expect(await paypal.captureAuthorization(captureInput, live())).toMatchObject({
        kind: "declined",
      });
    },
  );

  it("an already-captured authorization is unknown, so the caller finds the capture", async () => {
    // PayPal's refusal carries no capture id, and inventing one would be worse than asking.
    const { paypal } = operations(error(422, "AUTHORIZATION_ALREADY_CAPTURED"));
    expect(await paypal.captureAuthorization(captureInput, live())).toMatchObject({
      kind: "unknown",
    });
  });
});

describe("voiding a hold", () => {
  const voidInput = { authorizationId: "0VF52814937998046", requestId: REQUEST };

  it("voids under the void's own request id, and reads a 204 as voided", async () => {
    const { paypal, calls } = operations(new Response(null, { status: 204 }));
    expect(await paypal.voidAuthorization(voidInput, live())).toEqual({ kind: "voided" });
    const call = calls()[0];
    expect(call?.url).toBe(
      `${PAYPAL_SANDBOX_BASE_URL}/v2/payments/authorizations/0VF52814937998046/void`,
    );
    expect(call?.headers["paypal-request-id"]).toBe(REQUEST);
  });

  it("reads a returned authorization, and believes it over the call's success", async () => {
    const { paypal } = operations(json(200, { id: "0VF5", status: "CAPTURED" }));
    expect(await paypal.voidAuthorization(voidInput, live())).toMatchObject({
      kind: "not-voidable",
      status: "CAPTURED",
    });
  });

  it("asks what happened when PayPal says the hold has already ended", async () => {
    const { paypal, calls } = operations(
      error(422, "AUTHORIZATION_ALREADY_CAPTURED"),
      json(200, {
        id: "0VF52814937998046",
        status: "CAPTURED",
        supplementary_data: { related_ids: { capture_id: "CAP-7", order_id: "ORDER-1" } },
      }),
    );
    expect(await paypal.voidAuthorization(voidInput, live())).toEqual({
      kind: "not-voidable",
      status: "CAPTURED",
      captureId: "CAP-7",
    });
    expect(calls()).toHaveLength(2);
  });

  it("is unknown when PayPal will not say what state the hold is in", async () => {
    const { paypal } = operations(error(422, "PREVIOUSLY_VOIDED"), error(500, "SERVER_ERROR"));
    expect(await paypal.voidAuthorization(voidInput, live())).toMatchObject({ kind: "unknown" });
  });
});

describe("reading a hold", () => {
  it("reports the status and the capture PayPal relates to it", async () => {
    const { paypal, calls } = operations(
      json(200, {
        id: "0VF52814937998046",
        status: "CAPTURED",
        supplementary_data: { related_ids: { capture_id: "CAP-7" } },
      }),
    );
    expect(await paypal.getAuthorization("0VF52814937998046", live())).toEqual({
      kind: "found",
      status: "CAPTURED",
      captureId: "CAP-7",
    });
    expect(calls()[0]?.method).toBe("GET");
  });

  it("a status Slip does not know is unknown, not a guess", async () => {
    const { paypal } = operations(json(200, { id: "0VF5", status: "SOMETHING_NEW" }));
    expect(await paypal.getAuthorization("0VF5", live())).toMatchObject({ kind: "unknown" });
  });

  it("a hold PayPal has never heard of is unknown, which holds the payment open", async () => {
    const { paypal } = operations(error(404, "RESOURCE_NOT_FOUND"));
    expect(await paypal.getAuthorization("0VF5", live())).toMatchObject({ kind: "unknown" });
  });
});

describe("what a detail may say", () => {
  let secrets: string[] = [];
  beforeEach(() => {
    secrets = ["secret", "A-TOKEN", "free text from PayPal"];
  });

  it("names the status and the issue, and carries no secret and no PayPal prose", async () => {
    const { paypal } = operations(error(422, "DUPLICATE_INVOICE_ID"));
    const result = await paypal.createOrder(createInput, live());
    const reason = result.kind === "duplicate-invoice" ? result.reason : "";
    expect(reason).toContain("422");
    expect(reason).toContain("DUPLICATE_INVOICE_ID");
    // PayPal's debug id is an opaque handle for support, and is worth keeping.
    expect(reason).toContain("d-1234");
    for (const secret of secrets) {
      expect(reason).not.toContain(secret);
    }
  });
});
