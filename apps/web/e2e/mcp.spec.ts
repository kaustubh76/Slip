import { type APIResponse, expect, type Page, test } from "@playwright/test";
import { openDesk } from "./helpers";

/** A JSON-RPC answer from /api/mcp, whether it came back as JSON or as one SSE event. */
async function rpc(response: APIResponse): Promise<{ result?: Record<string, unknown> }> {
  const text = await response.text();
  if (text.startsWith("{")) {
    return JSON.parse(text);
  }
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .join("");
  return JSON.parse(data);
}

/** A key for a new agent, issued on the demo console. */
async function consoleKey(page: Page): Promise<string> {
  await page.goto("/demo");
  await page.getByRole("button", { name: "Issue a key for the script" }).click();
  const command = (await page.locator(".slip-key").textContent()) ?? "";
  return /SLIP_AGENT_KEY=(\S+)/.exec(command)?.[1] ?? "";
}

const HEADERS = {
  accept: "application/json, text/event-stream",
  "mcp-protocol-version": "2025-06-18",
};

test("Slip's MCP server answers an agent with a key, and turns away a call without one", async ({
  page,
}) => {
  const anonymous = await page.request.post("/api/mcp", {
    headers: HEADERS,
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
  });
  expect(anonymous.status()).toBe(401);
  expect(anonymous.headers()["www-authenticate"]).toMatch(/^Bearer realm="slip"/);

  await openDesk(page);
  const key = await consoleKey(page);
  const headers = { ...HEADERS, authorization: `Bearer ${key}` };
  const init = await page.request.post("/api/mcp", {
    headers,
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "e2e", version: "0" },
      },
    },
  });
  expect(init.status()).toBe(200);
  expect((await rpc(init)).result?.["serverInfo"]).toMatchObject({ name: "slip" });
  const list = await page.request.post("/api/mcp", {
    headers,
    data: { jsonrpc: "2.0", id: 2, method: "tools/list" },
  });
  const tools = ((await rpc(list)).result?.["tools"] ?? []) as { name: string }[];
  // In demo mode the desk's stand-in catalogue can be searched too.
  expect(tools.map((t) => t.name).sort()).toEqual([
    "checkout",
    "get_receipt",
    "get_report",
    "search_products",
  ]);
});
