import { type AttemptId, attemptId, type Cents } from "@slip/domain";
import type { Fetch } from "@slip/http";
import { describe, expect, it } from "vitest";
import { createPayPalGateway } from "./gateway.js";

/**
 * Finding an order Slip has no id for. The one answer that must never be wrong is "not found":
 * the resolver is allowed to give a payment up on it, so a record that exists must be found.
 */

const AMOUNT = 1299 as Cents;
const INVOICE = attemptId("11111111-1111-4111-8111-111111111111") as AttemptId;
const live = () => new AbortController().signal;
const FROM = new Date("2026-10-01T00:00:00Z");
const TO = new Date("2026-10-18T12:00:00Z");

interface Sent {
  url: string;
  headers: Record<string, string>;
}

function stub(...answers: (Response | Error)[]) {
  const sent: Sent[] = [];
  const queue = [...answers];
  const fetch = (async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
    const url = String(input);
    sent.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url.endsWith("/v1/oauth2/token")) {
      return json(200, { access_token: "A", expires_in: 32_400 });
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

/** One reporting record, as `fields=transaction_info` returns it. */
const record = (over: Record<string, unknown> = {}) => ({
  transaction_info: {
    transaction_id: "7X550106NA4440028",
    paypal_reference_id: "8K832279M55989614",
    paypal_reference_id_type: "ODR",
    transaction_status: "S",
    transaction_amount: { currency_code: "USD", value: "12.99" },
    invoice_id: INVOICE,
    custom_field: INVOICE,
    ...over,
  },
});

const page = (records: unknown[], over: Record<string, unknown> = {}) => ({
  transaction_details: records,
  total_items: records.length,
  total_pages: 1,
  page: 1,
  ...over,
});

const capturedOrder = {
  id: "8K832279M55989614",
  intent: "CAPTURE",
  status: "COMPLETED",
  purchase_units: [{ payments: { captures: [{ id: "7X550106NA4440028", status: "COMPLETED" }] } }],
};

const gateway = (...answers: (Response | Error)[]) => {
  const { fetch, sent } = stub(...answers);
  return {
    sent,
    paypal: createPayPalGateway({
      clientId: "client",
      clientSecret: "secret",
      webhookId: "WH-1",
      fetch,
    }),
    searches: () => sent.filter((call) => call.url.includes("/v1/reporting/transactions")),
  };
};

const input = { invoiceId: INVOICE, amountCents: AMOUNT, from: FROM, to: TO };

describe("what it asks reporting for", () => {
  it("asks over the caller's window, for records a hold would also appear in", async () => {
    const { paypal, searches } = gateway(json(200, page([record()])), json(200, capturedOrder));
    await paypal.findOrderByInvoice(input, live());
    const url = new URL(searches()[0]?.url ?? "https://x.example");
    expect(url.searchParams.get("start_date")).toBe("2026-10-01T00:00:00Z");
    expect(url.searchParams.get("end_date")).toBe("2026-10-18T12:00:00Z");
    expect(url.searchParams.get("fields")).toBe("transaction_info");
    // An authorization affects no balance; the default would hide the very thing being looked for.
    expect(url.searchParams.get("balance_affecting_records_only")).toBe("N");
    expect(searches()[0]?.headers["paypal-enforce-iso8601-format"]).toBe("true");
    // No invoice filter exists, and no narrower filter is sent: one could hide a real payment.
    expect(url.searchParams.get("transaction_amount")).toBeNull();
    expect(url.searchParams.get("transaction_status")).toBeNull();
  });

  it("never asks for a window wider than PayPal allows", async () => {
    const { paypal, searches } = gateway(json(200, page([])));
    await paypal.findOrderByInvoice({ ...input, from: new Date("2025-01-01T00:00:00Z") }, live());
    const url = new URL(searches()[0]?.url ?? "https://x.example");
    const start = new Date(url.searchParams.get("start_date") ?? 0).getTime();
    const days = (TO.getTime() - start) / (24 * 60 * 60 * 1000);
    expect(days).toBeCloseTo(31, 5);
  });
});

describe("what it makes of the records", () => {
  it("reads the order the record names, rather than trusting reporting about its state", async () => {
    const { paypal, sent } = gateway(json(200, page([record()])), json(200, capturedOrder));
    expect(await paypal.findOrderByInvoice(input, live())).toEqual({
      kind: "found",
      order: {
        kind: "captured",
        orderId: "8K832279M55989614",
        captureId: "7X550106NA4440028",
      },
    });
    expect(sent.some((call) => call.url.includes("/v2/checkout/orders/"))).toBe(true);
  });

  it("matches on the invoice id and the amount together", async () => {
    const { paypal } = gateway(
      json(
        200,
        page([
          record({ invoice_id: "another-attempt" }),
          record({ transaction_amount: { currency_code: "USD", value: "19.99" } }),
          record({ transaction_amount: { currency_code: "EUR", value: "12.99" } }),
        ]),
      ),
    );
    expect(await paypal.findOrderByInvoice(input, live())).toEqual({ kind: "not-found" });
  });

  it("recognises a reversal of the same payment, which is reported as its negative", async () => {
    const { paypal } = gateway(
      json(
        200,
        page([
          record({
            transaction_status: "V",
            transaction_amount: { currency_code: "USD", value: "-12.99" },
          }),
        ]),
      ),
      json(200, capturedOrder),
    );
    expect(await paypal.findOrderByInvoice(input, live())).toMatchObject({ kind: "found" });
  });

  it("walks the pages until it finds the attempt", async () => {
    const { paypal, searches } = gateway(
      json(200, page([record({ invoice_id: "other" })], { total_pages: 2 })),
      json(200, page([record()], { page: 2, total_pages: 2 })),
      json(200, capturedOrder),
    );
    expect(await paypal.findOrderByInvoice(input, live())).toMatchObject({ kind: "found" });
    expect(searches()).toHaveLength(2);
    expect(new URL(searches()[1]?.url ?? "https://x.example").searchParams.get("page")).toBe("2");
  });

  it("an empty window is not-found: PayPal has looked and has nothing", async () => {
    const { paypal } = gateway(json(200, page([])));
    expect(await paypal.findOrderByInvoice(input, live())).toEqual({ kind: "not-found" });
  });

  it("falls back on the record's own status when the order cannot be read", async () => {
    const { paypal } = gateway(json(200, page([record()])), json(500, { name: "SERVER_ERROR" }));
    expect(await paypal.findOrderByInvoice(input, live())).toEqual({
      kind: "found",
      order: {
        kind: "captured",
        orderId: "8K832279M55989614",
        captureId: "7X550106NA4440028",
      },
    });
  });

  it("a matched payment that names no order is unknown, which keeps it open for a person", async () => {
    const { paypal } = gateway(json(200, page([record({ paypal_reference_id_type: "TXN" })])));
    const result = await paypal.findOrderByInvoice(input, live());
    expect(result).toMatchObject({ kind: "unknown" });
    expect(result.kind === "unknown" && result.reason).toContain("named no order");
  });
});

describe("what it refuses to conclude", () => {
  it.each([[403], [429], [500]])(
    "a %i is unknown, never not-found: Slip has not looked",
    async (status) => {
      const { paypal } = gateway(json(status, { name: "NOT_AUTHORIZED" }));
      expect(await paypal.findOrderByInvoice(input, live())).toMatchObject({ kind: "unknown" });
    },
  );

  it("an unreachable PayPal is unknown", async () => {
    const { paypal } = gateway(new TypeError("fetch failed"));
    expect(await paypal.findOrderByInvoice(input, live())).toMatchObject({ kind: "unknown" });
  });

  it("more pages than it will read is unknown, not an answer", async () => {
    // Saying "not found" with pages unread is what could cost a second charge.
    const pages = Array.from({ length: 10 }, () =>
      json(200, page([record({ invoice_id: "other" })], { total_pages: 99 })),
    );
    const { paypal, searches } = gateway(...pages);
    const result = await paypal.findOrderByInvoice(input, live());
    expect(result).toMatchObject({ kind: "unknown" });
    expect(searches()).toHaveLength(10);
  });
});
