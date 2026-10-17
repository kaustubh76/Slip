import { hashApiKey, issueAgentKey, revokeMandate, runCheckout } from "@slip/app";
import type { OwnerId } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { runAgent, type ErrandListing as ScriptListing } from "../../../scripts/agent";
import { checkoutResponse } from "../agent-api";
import { demoWorld } from "./__fixtures__/world";
import { errandsFor } from "./errands-api";
import { seedDemoOwner } from "./seed";

const BASE = "http://localhost:3100";

/** The demo agent script against a desk, with `fetch` answered by the same code as the routes. */
async function scripted() {
  const world = demoWorld();
  const owner = await seedDemoOwner(world.deps, world.fakes);
  const issued = await issueAgentKey(world.deps, owner.ownerId as OwnerId, owner.mandateId, {
    name: "agent script",
  });
  if (issued.status !== "issued") {
    throw new Error("no key");
  }
  const fetch = (async (url: string, init?: RequestInit) => {
    const key = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "") ?? "";
    if (url === `${BASE}/api/v1/demo/errands`) {
      const auth = await world.deps.store.agents.authenticate(hashApiKey(key));
      return Response.json(
        auth === null
          ? { message: "Unknown or revoked API key." }
          : { agent: auth.agent.name, errands: errandsFor(auth.mandate.id, world.fakes.offers) },
        { status: auth === null ? 401 : 200 },
      );
    }
    if (url === `${BASE}/api/v1/agent/checkout`) {
      const answer = checkoutResponse(
        await runCheckout(world.deps, key, JSON.parse(String(init?.body))),
      );
      return Response.json(answer.body, { status: answer.status });
    }
    return Response.json({ message: "no such route" }, { status: 404 });
  }) as typeof globalThis.fetch;
  const run = (errand: string | null, key = issued.apiKey) =>
    runAgent({ base: BASE, key, errand, fetch, now: () => 0 });
  return { world, owner, run };
}

describe("the demo agent script", () => {
  it("prints the search with its synthetic label, the pick, and Slip's rejection", async () => {
    const { run } = await scripted();
    const { code, lines } = await run("top-pick");
    expect(code).toBe(0);
    const text = lines.join("\n");
    expect(text).toContain('searching the stand-in Channel3 for "Trail shoe"');
    expect(text).toMatch(
      /Store A +\$58\.99 {3}new, in stock {3}pays the agent's platform up to 8%/,
    );
    expect(text).toContain('listing says: "[synthetic] Top pick"');
    expect(text).toContain('picks Store A at $58.99, because "Top pick badge, ships fastest"');
    expect(text).toContain("REJECTED by R4_OVERPAID");
    expect(text).toContain("Overpaid by $11.00 (23%).");
    expect(text).toContain("Payment rejected. Nothing was charged.");
    // No PayPal order was ever made for a rejection.
    expect(text).not.toContain("paypal ");
    expect(text).toMatch(
      /receipt no\. [0-9a-f]{4}…[0-9a-f]{4} {2}http:\/\/localhost:3100\/receipts\//,
    );
  });

  it("pays for the cheaper shoe, and says so only once PayPal captured it", async () => {
    const { run } = await scripted();
    const { code, lines } = await run("cheaper");
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("PAID by R7_WITHIN_LIMITS");
    expect(lines.join("\n")).toContain("Paid $47.99 at Store B.");
    expect(lines.join("\n")).toMatch(/paypal {2}CAPTURED, order \S+ \(simulated\)/);
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
    expect(lines.join("\n")).toContain("refused in 0.0s (403 MANDATE_NOT_ACTIVE)");
    expect(lines.join("\n")).toContain("Nothing was checked and nothing was charged.");
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
    expect(unknown).toMatchObject({ code: 2 });
    expect(unknown.lines[0]).toContain("(401): Unknown or revoked API key.");
  });

  it("reads the listing the server sends, field for field", () => {
    const world = demoWorld();
    const listing: ScriptListing[] = errandsFor(
      "0190a1b2-0000-7000-8000-000000000000",
      world.fakes.offers,
    );
    expect(listing.map((e) => e.name)).toContain("top-pick");
  });
});
