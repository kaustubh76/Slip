import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { revokeMandate } from "@slip/app";
import { offer } from "@slip/domain/testing";
import {
  createSlipMcpEndpoint,
  type ProductSearch,
  ToolReceiptSchema,
  ToolReportSchema,
} from "@slip/mcp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { market, openWorld, type Seeded, seedAgent, type World } from "./testkit.js";

const URL_ = new URL("http://localhost:3000/api/mcp");
const MODERN = "2026-07-28";

/**
 * Slip's MCP endpoint over HTTP, as a host mounts it: real Request and Response objects, a real
 * MCP client on both protocol eras, and the checks in front of the exchange.
 */
describe("the MCP endpoint", () => {
  let w: World;
  let agent: Seeded;
  let errors: unknown[];
  let searchedFor: string[];
  let endpoint: (request: Request) => Promise<Response>;
  const clients: Client[] = [];

  const catalogue: ProductSearch = {
    simulated: true,
    search: async () => ({ ok: true, hits: [] }),
  };

  beforeEach(async () => {
    w = await openWorld("memory");
    agent = await seedAgent(w);
    errors = [];
    searchedFor = [];
    endpoint = createSlipMcpEndpoint({
      deps: async () => w.deps,
      search: (mandateId) => {
        searchedFor.push(mandateId);
        return catalogue;
      },
      onError: (error) => errors.push(error),
    });
  });
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.close().catch(() => undefined)));
    await w.close();
  });

  async function connect(era: "legacy" | "modern", key = agent.apiKey): Promise<Client> {
    const transport = new StreamableHTTPClientTransport(URL_, {
      fetch: (input, init) => endpoint(new Request(input, init)),
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    });
    const client = new Client(
      { name: "test-agent", version: "1.0.0" },
      era === "modern" ? { versionNegotiation: { mode: { pin: MODERN } } } : {},
    );
    await client.connect(transport);
    clients.push(client);
    return client;
  }

  /** A raw JSON-RPC POST the way a 2025-era client sends one; reads a JSON or SSE answer. */
  async function post(body: unknown, headers: Record<string, string> = {}) {
    const response = await endpoint(
      new Request(URL_, {
        method: "POST",
        headers: {
          authorization: `Bearer ${agent.apiKey}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-06-18",
          ...headers,
        },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
    const text = await response.text();
    const json = text.startsWith("{")
      ? JSON.parse(text)
      : JSON.parse(
          text
            .split("\n")
            .filter((line) => line.startsWith("data: "))
            .map((line) => line.slice(6))
            .join("") || "null",
        );
    return { response, json };
  }

  for (const era of ["legacy", "modern"] as const) {
    it(`serves a ${era} client: tools listed, a purchase paid`, async () => {
      const client = await connect(era);
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["checkout", "get_receipt", "get_report", "search_products"]);
      const chosen = offer({ price: 10 });
      market(w, "lamp", [chosen, offer({ price: 11 })]);
      const result = await w.settle(
        client.callTool({
          name: "checkout",
          arguments: { product_id: "lamp", chosen_offer_url: chosen.url, reason: "cheapest" },
        }),
      );
      expect(ToolReceiptSchema.parse(result.structuredContent)).toMatchObject({
        outcome: "PAID",
        payment_status: "CAPTURED",
      });
      expect(searchedFor.every((m) => m === agent.mandateId)).toBe(true);
      expect(searchedFor.length).toBeGreaterThan(0);
    });
  }

  it("answers a 2025-era client's raw initialize and tools/list", async () => {
    const init = await post({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "curl", version: "0" },
      },
    });
    expect(init.response.status).toBe(200);
    expect(init.json.result.serverInfo).toMatchObject({ name: "slip" });
    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(list.json.result.tools.map((t: { name: string }) => t.name)).toContain("checkout");
  });

  it("turns away a missing, unknown or revoked key with a 401 an HTTP client can read", async () => {
    for (const authorization of [undefined, "Bearer slip_live_nope", "Basic abc"]) {
      const headers = new Headers({ "content-type": "application/json" });
      if (authorization !== undefined) {
        headers.set("authorization", authorization);
      }
      const response = await endpoint(
        new Request(URL_, {
          method: "POST",
          headers,
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        }),
      );
      expect(response.status, String(authorization)).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Bearer realm="slip"/);
    }
    // Revoked mid-conversation: the next call is refused.
    const client = await connect("legacy");
    await w.store.agents.revoke(agent.agentId, w.clock.now());
    await expect(client.callTool({ name: "get_report", arguments: {} })).rejects.toThrow();
  });

  it("still lets an agent read after the permission is cancelled, but not buy", async () => {
    const client = await connect("modern");
    await w.settle(revokeMandate(w.deps, agent.ownerId, agent.mandateId));
    const report = await client.callTool({ name: "get_report", arguments: {} });
    expect(ToolReportSchema.parse(report.structuredContent).attempted).toBe(0);
    const chosen = offer({ price: 10 });
    market(w, "lamp", [chosen]);
    const refused = await w.settle(
      client.callTool({
        name: "checkout",
        arguments: { product_id: "lamp", chosen_offer_url: chosen.url, reason: "" },
      }),
    );
    expect(refused.isError).toBe(true);
    expect((refused.content as { text: string }[])[0]?.text).toMatch(
      /^Refused \(MANDATE_NOT_ACTIVE\)/,
    );
  });

  it("refuses a browser page on another site, and accepts Slip's own origin", async () => {
    const tools = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect((await post(tools, { origin: "https://evil.example" })).response.status).toBe(403);
    expect((await post(tools, { origin: "http://localhost:3000" })).response.status).toBe(200);
  });

  it("refuses an oversized body, and the 2025 session methods it does not keep", async () => {
    const big = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { pad: "x".repeat(70_000) },
    });
    expect((await post(big)).response.status).toBe(413);
    for (const method of ["GET", "DELETE"]) {
      const response = await endpoint(
        new Request(URL_, {
          method,
          headers: {
            authorization: `Bearer ${agent.apiKey}`,
            "mcp-protocol-version": "2025-06-18",
          },
        }),
      );
      expect(response.status, method).toBe(405);
    }
  });

  it("never writes the key into a log line or an error", async () => {
    const client = await connect("legacy");
    await client.callTool({ name: "get_report", arguments: {} });
    await post("{not json");
    expect(JSON.stringify(w.logs)).not.toContain(agent.apiKey);
    expect(errors.map(String).join("\n")).not.toContain(agent.apiKey);
  });
});
