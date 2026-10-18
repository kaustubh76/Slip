import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { getReceipt, renderReport, revokeMandate } from "@slip/app";
import { PgliteTemplate } from "@slip/db/testing";
import { offer } from "@slip/domain/testing";
import {
  createSlipServer,
  SLIP_INSTRUCTIONS,
  ToolReceiptSchema,
  ToolReportSchema,
} from "@slip/mcp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  market,
  openWorld,
  type Seeded,
  type StoreKind,
  seedAgent,
  type World,
} from "./testkit.js";

/**
 * Slip's MCP tools end to end: a real MCP client talks to the server over an in-memory transport,
 * and every call runs the real use cases on both stores, with PayPal's calls counted.
 */
describe.each<StoreKind>(["memory", "pglite"])("the MCP tools on the %s store", (kind) => {
  let template: PgliteTemplate | undefined;
  let w: World;
  let agent: Seeded;
  let clients: Client[];

  beforeAll(async () => {
    template = kind === "pglite" ? await PgliteTemplate.create() : undefined;
  });
  afterAll(async () => {
    await template?.close();
  });
  beforeEach(async () => {
    w = await openWorld(kind, template === undefined ? {} : { template });
    agent = await seedAgent(w);
    clients = [];
  });
  afterEach(async () => {
    await Promise.all(clients.map((c) => c.close()));
    await w.close();
  });

  async function connect(apiKey = agent.apiKey): Promise<Client> {
    const server = createSlipServer({ deps: w.deps, apiKey });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test-agent", version: "1.0.0" });
    await client.connect(clientSide);
    clients.push(client);
    return client;
  }

  /** The trail shoe: $58.99 with a "Top pick" label and 8% commission, $47.99 at 2%, $52.00. */
  function shoe(productId = "trail-shoe") {
    const pricey = offer({ price: 58.99, domain: "store-a.example", rate: 0.08, text: "Top pick" });
    const cheap = offer({ price: 47.99, domain: "store-b.example", rate: 0.02 });
    market(w, productId, [pricey, cheap, offer({ price: 52, domain: "store-c.example" })]);
    return { productId, pricey, cheap };
  }

  const checkout = (client: Client, args: Record<string, unknown>) =>
    w.settle(client.callTool({ name: "checkout", arguments: args }));
  const receiptOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
    ToolReceiptSchema.parse(result.structuredContent);
  const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
    (result.content as { type: string; text: string }[]).map((c) => c.text).join("\n");

  it("lists three tools with their schemas, and tells the agent how Slip works", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["checkout", "get_receipt", "get_report"]);
    const buy = tools.find((t) => t.name === "checkout");
    expect(Object.keys(buy?.inputSchema.properties ?? {}).sort()).toEqual([
      "chosen_offer_url",
      "product_id",
      "reason",
      "selected_options",
    ]);
    expect(buy?.inputSchema.required?.sort()).toEqual(["chosen_offer_url", "product_id", "reason"]);
    expect(buy?.outputSchema?.["properties"]).toHaveProperty("next_step");
    expect(buy?.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
    expect(tools.find((t) => t.name === "get_receipt")?.annotations?.readOnlyHint).toBe(true);
    expect(client.getInstructions()).toBe(SLIP_INSTRUCTIONS);
  });

  it("pays for the cheapest offer, and the receipt is the one the owner reads", async () => {
    const client = await connect();
    const { productId, cheap } = shoe();
    const result = await checkout(client, {
      product_id: productId,
      chosen_offer_url: cheap.url,
      reason: "lowest listed price",
    });
    expect(result.isError).toBeFalsy();
    const receipt = receiptOf(result);
    expect(receipt).toMatchObject({
      outcome: "PAID",
      rule: "R7_WITHIN_LIMITS",
      replayed: false,
      charged: true,
      payment_status: "CAPTURED",
      in_flight: false,
      next_step: "Nothing more to do: the purchase is complete.",
    });
    expect(receipt.paypal_order_id).not.toBeNull();
    expect(receipt.receipt_url).toBe(`http://localhost:3000/receipts/${receipt.receipt_id}`);
    const owner = await getReceipt(w.deps, agent.apiKey, receipt.receipt_id);
    expect(owner.status === "found" && owner.view.lines).toEqual(receipt.receipt);
    expect(textOf(result)).toContain("PAID by R7_WITHIN_LIMITS.");
  });

  it("rejects the pricier pick, names the lowest offer and how to buy it, and charges nothing", async () => {
    const client = await connect();
    const { productId, pricey, cheap } = shoe();
    const receipt = receiptOf(
      await checkout(client, {
        product_id: productId,
        chosen_offer_url: pricey.url,
        reason: "Top pick badge",
      }),
    );
    expect(receipt).toMatchObject({
      outcome: "REJECTED",
      rule: "R4_OVERPAID",
      charged: false,
      payment_status: "NONE",
      paypal_order_id: null,
      gap_abs: "$11.00",
      gap_pct: "23%",
      best_offer: { store: "Store B", url: cheap.url, price: "$47.99", price_cents: 4799 },
    });
    expect(receipt.next_step).toContain(`chosen_offer_url ${cheap.url}`);
    expect(w.gateway.callsTo("createOrder")).toHaveLength(0);
  });

  it("holds a purchase above the order cap for the owner, with when the hold runs out", async () => {
    const client = await connect();
    const chosen = offer({ price: 250 });
    market(w, "headphones", [chosen, offer({ price: 251 })]);
    const receipt = receiptOf(
      await checkout(client, {
        product_id: "headphones",
        chosen_offer_url: chosen.url,
        reason: "",
      }),
    );
    expect(receipt).toMatchObject({
      outcome: "HELD",
      rule: "R6_ABOVE_ORDER_CAP",
      charged: false,
      payment_status: "AUTHORIZED",
      hold: { status: "PENDING" },
    });
    expect(receipt.next_step).toMatch(/^Your owner decides by /);
  });

  it("ignores a price the agent sends, and replays a repeat instead of paying twice", async () => {
    const client = await connect();
    const { productId, cheap } = shoe();
    const args = { product_id: productId, chosen_offer_url: cheap.url, reason: "", price: 0.01 };
    const first = receiptOf(await checkout(client, args));
    expect(first.chosen_offer?.price).toBe("$47.99");
    const again = receiptOf(await checkout(client, args));
    expect(again).toMatchObject({
      receipt_id: first.receipt_id,
      replayed: true,
      replay_reason: "ALREADY_PAID",
    });
    expect(again.next_step).toMatch(/do not buy the item again/);
    expect(w.gateway.callsTo("createOrder")).toHaveLength(1);
  });

  it("refuses, as a tool error, when the owner has cancelled the permission", async () => {
    const client = await connect();
    const { productId, cheap } = shoe();
    const paid = receiptOf(
      await checkout(client, { product_id: productId, chosen_offer_url: cheap.url, reason: "" }),
    );
    await w.settle(revokeMandate(w.deps, agent.ownerId, agent.mandateId));
    const { productId: other, cheap: offerTwo } = shoe("trail-shoe-2");
    const refused = await checkout(client, {
      product_id: other,
      chosen_offer_url: offerTwo.url,
      reason: "",
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toMatch(/^Refused \(MANDATE_NOT_ACTIVE\): /);
    // What already happened stays readable.
    const read = await client.callTool({
      name: "get_receipt",
      arguments: { receipt_id: paid.receipt_id },
    });
    expect(read.isError).toBeFalsy();
    expect(receiptOf(read).receipt_id).toBe(paid.receipt_id);
  });

  it("answers bad arguments with a tool error the agent can correct", async () => {
    const client = await connect();
    const result = await checkout(client, {
      product_id: "trail-shoe",
      chosen_offer_url: "not a url",
      reason: "",
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/chosen_offer_url/);
  });

  it("refuses while another checkout holds the item, and after too many attempts names the decision that stands", async () => {
    const client = await connect();
    const { productId, cheap } = shoe();
    await w.store.leases.acquire(
      { agentId: agent.agentId, productId },
      "elsewhere",
      60_000,
      w.clock.now(),
    );
    const busy = await checkout(client, {
      product_id: productId,
      chosen_offer_url: cheap.url,
      reason: "",
    });
    expect(textOf(busy)).toMatch(/^Refused \(BUSY\): /);

    const pricey = [30, 31, 32, 33, 34].map((price) => offer({ price }));
    market(w, "lamp", [offer({ price: 10 }), ...pricey]);
    let last = "";
    for (const chosen of pricey) {
      const result = await checkout(client, {
        product_id: "lamp",
        chosen_offer_url: chosen.url,
        reason: "",
      });
      last = textOf(result);
    }
    expect(last).toMatch(
      /^Refused \(RETRY_LIMIT\): .* The decision that stands is receipt_id [0-9a-f-]{36}\.$/,
    );
  });

  it("reads only the agent's own receipts", async () => {
    const client = await connect();
    const other = await seedAgent(w);
    const { productId, cheap } = shoe();
    const theirs = receiptOf(
      await checkout(await connect(other.apiKey), {
        product_id: productId,
        chosen_offer_url: cheap.url,
        reason: "",
      }),
    );
    for (const id of [theirs.receipt_id, "not-a-receipt"]) {
      const result = await client.callTool({ name: "get_receipt", arguments: { receipt_id: id } });
      expect(result.isError, id).toBe(true);
      expect(textOf(result), id).toMatch(/^Refused \(NOT_FOUND\): /);
    }
  });

  it("reports the agent's record the way the report card does", async () => {
    const client = await connect();
    const { productId, pricey, cheap } = shoe();
    await checkout(client, { product_id: productId, chosen_offer_url: pricey.url, reason: "" });
    await checkout(client, { product_id: productId, chosen_offer_url: cheap.url, reason: "" });
    const result = await client.callTool({ name: "get_report", arguments: {} });
    const report = ToolReportSchema.parse(result.structuredContent);
    const expected = renderReport(await w.store.reports.agentReport(agent.agentId));
    expect(report).toMatchObject({
      attempted: 2,
      paid: 1,
      rejected: 1,
      not_cheapest: 1,
      report: expected.lines,
    });
    expect(textOf(result)).toBe(expected.lines.join("\n"));
  });

  it("answers a failure inside Slip with a fixed sentence, logs it, and never logs the key", async () => {
    const client = await connect();
    vi.spyOn(w.store.attempts, "get").mockRejectedValue(new Error("connection reset by 10.0.0.5"));
    const result = await client.callTool({
      name: "get_receipt",
      arguments: { receipt_id: "0190a1b2-0000-7000-8000-000000000001" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^Slip could not answer that just now\./);
    expect(textOf(result)).not.toContain("10.0.0.5");
    expect(w.logs.some((l) => l.event === "mcp.tool_failed")).toBe(true);
    expect(JSON.stringify(w.logs)).not.toContain(agent.apiKey);
  });
});
