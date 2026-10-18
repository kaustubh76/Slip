import { mandateId, type RequestId, requestId } from "@slip/domain";
import type { Fetch } from "@slip/http";
import { describe, expect, it } from "vitest";
import { createPayPalApi, PAYPAL_SANDBOX_BASE_URL } from "./client.js";
import { createVaultOperations } from "./vault.js";

/** Vaulting the owner's wallet, against PayPal's documented setup- and payment-token answers. */

const REQUEST = requestId("33333333-3333-4333-8333-333333333333") as RequestId;
const live = () => new AbortController().signal;

interface Sent {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(...answers: (Response | Error)[]) {
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
      return json(200, { access_token: "A-TOKEN", expires_in: 32_400 });
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
    name: "UNPROCESSABLE_ENTITY",
    message: "free text",
    debug_id: "d-9",
    details: issues.map((issue) => ({ issue })),
  });

const vault = (...answers: (Response | Error)[]) => {
  const { fetch, sent } = stub(...answers);
  return {
    sent,
    paypal: createVaultOperations(
      createPayPalApi({ clientId: "client", clientSecret: "secret", fetch }),
      { brandName: "Slip" },
    ),
    calls: () => sent.filter((call) => !call.url.endsWith("/v1/oauth2/token")),
  };
};

const setupInput = {
  mandateId: mandateId("44444444-4444-4444-8444-444444444444"),
  requestId: REQUEST,
  returnUrl: "https://slip.example/permissions/back",
  cancelUrl: "https://slip.example/permissions/cancel",
};

describe("starting a setup", () => {
  it("asks for the charge the owner is actually approving", async () => {
    const { paypal, calls } = vault(
      json(201, {
        id: "4G4976650J0948357",
        status: "PAYER_ACTION_REQUIRED",
        customer: { id: "customer_4029352050" },
        links: [
          { rel: "self", method: "GET", href: "https://api-m.sandbox.paypal.com/v3/vault/x" },
          {
            rel: "approve",
            method: "GET",
            href: "https://www.sandbox.paypal.com/agreements/approve?approval_session_id=4G4",
          },
        ],
      }),
    );
    expect(await paypal.startVaultSetup(setupInput, live())).toEqual({
      kind: "started",
      reference: "4G4976650J0948357",
      approveUrl: "https://www.sandbox.paypal.com/agreements/approve?approval_session_id=4G4",
    });
    const call = calls()[0];
    expect(call?.url).toBe(`${PAYPAL_SANDBOX_BASE_URL}/v3/vault/setup-tokens`);
    expect(call?.headers["paypal-request-id"]).toBe(REQUEST);
    // The usage pattern here is the one the charge sends: the owner approves what will happen.
    expect(call?.body).toEqual({
      payment_source: {
        paypal: {
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          usage_pattern: "UNSCHEDULED_POSTPAID",
          experience_context: {
            return_url: "https://slip.example/permissions/back",
            cancel_url: "https://slip.example/permissions/cancel",
            brand_name: "Slip",
          },
        },
      },
    });
  });

  it("a setup with no approval link to send the owner to is a failure", async () => {
    const { paypal } = vault(json(201, { id: "4G4", status: "APPROVED", links: [] }));
    expect(await paypal.startVaultSetup(setupInput, live())).toMatchObject({ kind: "failed" });
  });

  it("a refusal is a failure the owner can retry, not an unknown", async () => {
    // Nothing exists yet: no token, no approval, nothing to resolve later.
    const { paypal } = vault(error(422, "NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE"));
    const result = await paypal.startVaultSetup(setupInput, live());
    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.reason).toContain("422");
    expect(result.kind === "failed" && result.reason).not.toContain("free text");
  });
});

describe("finishing a setup", () => {
  const complete = { reference: "4G4976650J0948357", requestId: REQUEST };

  it("exchanges the approved setup token for the vault id Slip will charge", async () => {
    const { paypal, calls } = vault(
      json(201, { id: "jwgvx42", customer: { id: "customer_4029352050" } }),
    );
    expect(await paypal.completeVaultSetup(complete, live())).toEqual({
      kind: "vaulted",
      vaultId: "jwgvx42",
      customerId: "customer_4029352050",
    });
    expect(calls()[0]?.url).toBe(`${PAYPAL_SANDBOX_BASE_URL}/v3/vault/payment-tokens`);
    expect(calls()[0]?.body).toEqual({
      payment_source: { token: { id: "4G4976650J0948357", type: "SETUP_TOKEN" } },
    });
  });

  it("an answer with no token yet is pending: the vault id arrives by webhook", async () => {
    const { paypal } = vault(json(202, { customer: { id: "customer_1" } }));
    expect(await paypal.completeVaultSetup(complete, live())).toEqual({
      kind: "pending",
      customerId: "customer_1",
    });
  });

  it.each([["PAYER_ACTION_REQUIRED"], ["SETUP_TOKEN_NOT_TOKENIZED"]])(
    "%s means the owner has not finished, which is not a failure",
    async (issue) => {
      const { paypal } = vault(error(422, issue));
      expect(await paypal.completeVaultSetup(complete, live())).toEqual({ kind: "not-approved" });
    },
  );

  it("a PayPal that never answered is a failure, not a silent vaulting", async () => {
    const down = new TypeError("fetch failed");
    const { paypal } = vault(down);
    expect(await paypal.completeVaultSetup(complete, live())).toMatchObject({ kind: "failed" });
  });
});

describe("deleting a token", () => {
  it("deletes it, and says so", async () => {
    const { paypal, calls } = vault(new Response(null, { status: 204 }));
    expect(await paypal.deleteVaultToken("jwgvx42", live())).toEqual({ kind: "deleted" });
    expect(calls()[0]?.method).toBe("DELETE");
    expect(calls()[0]?.url).toBe(`${PAYPAL_SANDBOX_BASE_URL}/v3/vault/payment-tokens/jwgvx42`);
  });

  it("a token already gone is the outcome the owner asked for", async () => {
    // A revoke must not fail because PayPal got there first.
    const { paypal } = vault(error(404, "RESOURCE_NOT_FOUND"));
    expect(await paypal.deleteVaultToken("jwgvx42", live())).toEqual({ kind: "already-gone" });
  });

  it("anything else is a failure, so the revoke is tried again", async () => {
    const { paypal } = vault(error(503, "SERVICE_UNAVAILABLE"));
    expect(await paypal.deleteVaultToken("jwgvx42", live())).toMatchObject({ kind: "failed" });
  });
});
