import { issueAgentKey, revokeMandate } from "@slip/app";
import type { OwnerId } from "@slip/domain";
import { createSlipMcpEndpoint, toolSearch } from "@slip/mcp";
import { describe, expect, it } from "vitest";
import { runAgent, SCRIPT_ERRANDS } from "../../../scripts/agent";
import { demoWorld } from "./__fixtures__/world";
import { ERRANDS, productIdFor } from "./catalogue";
import { deskSearch } from "./search";
import { seedDemoOwner } from "./seed";

const BASE = "http://localhost:3100";

/**
 * The demo agent script against a desk, its `fetch` answered by the same MCP endpoint the web app
 * serves at /api/mcp, with the desk's catalogue search behind it.
 */
async function scripted() {
  const world = demoWorld();
  const owner = await seedDemoOwner(world.deps, world.fakes);
  const issued = await issueAgentKey(world.deps, owner.ownerId as OwnerId, owner.mandateId, {
    name: "agent script",
  });
  if (issued.status !== "issued") {
    throw new Error("no key");
  }
  const endpoint = createSlipMcpEndpoint({
    deps: async () => world.deps,
    search: (mandateId) => deskSearch(world.fakes.offers, mandateId),
  });
  const fetch = ((input: string | URL | Request, init?: RequestInit) =>
    endpoint(new Request(input, init))) as typeof globalThis.fetch;
  const run = (errand: string | null, key = issued.apiKey) =>
    runAgent({ base: BASE, key, errand, fetch, now: () => 0 });
  return { world, owner, run };
}

describe("the demo agent script", () => {
  it("searches over MCP, prints the synthetic label and its pick, and Slip's rejection", async () => {
    const { owner, run } = await scripted();
    const { code, lines } = await run("top-pick");
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain(`Slip demo agent · MCP · ${BASE}/api/mcp`);
    expect(text).toContain('agent   search_products "trail shoe"');
    expect(text).toContain(
      `slip    Trail shoe (product_id ${productIdFor("trail-shoe", owner.mandateId)})`,
    );
    expect(text).toMatch(/Store A +\$58\.99 {3}new, in stock {3}commission up to 8%/);
    expect(text).toContain('listing text: "[synthetic] Top pick"');
    expect(text).toContain('checkout Store A at $58.99, because "Top pick badge, ships fastest"');
    expect(text).toContain("in 0.0s: REJECTED by R4_OVERPAID");
    expect(text).toContain("Overpaid by $11.00 (23%).");
    expect(text).toContain("Payment rejected. Nothing was charged.");
    expect(text).toMatch(
      /next {4}If you still want this item, the lowest listed offer is \$47\.99 at Store B: call checkout with chosen_offer_url https:\/\/store-b\.example\//,
    );
    // No PayPal order was ever made for a rejection.
    expect(text).not.toContain("paypal ");
    expect(text).toMatch(
      /receipt no\. [0-9a-f]{4}…[0-9a-f]{4} {2}http:\/\/localhost:3100\/receipts\//,
    );
  });

  it("pays for the cheaper shoe, and prints PayPal's order", async () => {
    const { run } = await scripted();
    const text = (await run("cheaper")).lines.join("\n");
    expect(text).toContain("PAID by R7_WITHIN_LIMITS");
    expect(text).toContain("Paid $47.99 at Store B.");
    expect(text).toMatch(/paypal {2}CAPTURED, order \S+ \(simulated\)/);
    expect(text).toContain("next    Nothing more to do: the purchase is complete.");
  });

  it("says the second run of an errand is the earlier decision, not a new one", async () => {
    const { run } = await scripted();
    await run("top-pick");
    const again = (await run("top-pick")).lines.join("\n");
    expect(again).toContain(
      "the same purchase again, so the earlier decision stands (RECENTLY_REJECTED)",
    );
  });

  it("is refused once the owner cancels the permission, and nothing is charged", async () => {
    const { world, owner, run } = await scripted();
    const revoked = await revokeMandate(world.deps, owner.ownerId as OwnerId, owner.mandateId);
    expect(revoked.status).toBe("revoked");
    const { code, lines } = await run("cheaper");
    expect(code).toBe(1);
    expect(lines.join("\n")).toMatch(/slip {4}in 0\.0s: Refused \(MANDATE_NOT_ACTIVE\): /);
  });

  it("lists the errands, marks the one only the console can run, and refuses an unknown key", async () => {
    const { run } = await scripted();
    const listed = await run(null);
    expect(listed.code).toBe(0);
    expect(listed.lines.join("\n")).toMatch(
      /offers-down +Buys a \$310 standing desk.*\(console only\)/,
    );
    const offline = await run("offers-down");
    expect(offline.code).toBe(2);
    expect(offline.lines.join("\n")).toContain("http://localhost:3100/demo");
    const unknown = await run("top-pick", "slip_live_nope");
    expect(unknown.code).toBe(2);
    expect(unknown.lines[0]).toMatch(
      /^Slip's MCP server at http:\/\/localhost:3100\/api\/mcp would not talk/,
    );
  });

  it("picks, for every errand, the offer the console's errand of the same name buys", async () => {
    const { world, owner } = await scripted();
    const search = deskSearch(world.fakes.offers, owner.mandateId);
    for (const [name, errand] of Object.entries(SCRIPT_ERRANDS)) {
      const answer = await search.search(errand.query, { limit: 1 }, new AbortController().signal);
      if (!answer.ok) {
        throw new Error(`search failed for ${name}`);
      }
      const found = toolSearch(answer, true).products[0];
      if (found === undefined) {
        throw new Error(`search found nothing for ${name}`);
      }
      const onConsole = ERRANDS[name as keyof typeof ERRANDS];
      expect(errand.pick(found)?.url, name).toBe(onConsole.chosenUrl);
      // The script and the console look for the same thing, so a query that drifts is caught too.
      expect(errand.query, name).toBe(onConsole.query);
      expect([errand.label, errand.reason], name).toEqual([onConsole.label, onConsole.reason]);
    }
  });
});
