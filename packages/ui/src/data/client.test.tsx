import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { heldView, rejectedView } from "../seed/views.js";
import { seedSlipQueries } from "../server.js";
import { createSlipClient, SlipClientError } from "./client.js";
import type { SlipCommands } from "./commands.js";
import { slipKeys } from "./keys.js";
import { SlipProvider, useSlip } from "./provider.js";

const agent = { id: "agent-1", name: "shopper-1" };
const page = { rows: [{ view: rejectedView(), agent }], next: null };

/** A fetch that answers from a table of paths. */
function fakeFetch(routes: Record<string, { status?: number; body: unknown } | Error>) {
  const calls: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const route = routes[url];
    if (route === undefined) {
      return new Response("{}", { status: 404 });
    }
    if (route instanceof Error) {
      throw route;
    }
    return Response.json(route.body, { status: route.status ?? 200 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const commands: SlipCommands = {
  previewApproval: async () => ({ status: "unknown" }),
  approveHold: async () => {
    throw new TypeError("network gone");
  },
  declineHold: async () => ({ status: "refused", reason: "ALREADY_DECIDED", message: "decided" }),
  updateLimits: async () => ({ status: "updated", version: 2 }),
  revokeMandate: async () => ({ status: "unknown" }),
  issueKey: async () => ({ status: "issued", name: "a", apiKey: "slip_live_x" }),
  revokeKey: async () => ({ status: "revoked" }),
};

describe("createSlipClient", () => {
  it("reads each page and checks it against its wire schema", async () => {
    const { fetch, calls } = fakeFetch({
      "/api/v1/receipts?before=abc&agent=agent-1&limit=5": { body: page },
      "/api/v1/holds": { body: { pending: [{ view: heldView(), agent }], decided: [] } },
      "/api/v1/stamp": { body: { token: "1.0.0.0.0.1.0.1.0" } },
    });
    const client = createSlipClient({ fetch, commands });
    expect(
      (await client.receipts({ before: "abc", agent: "agent-1", limit: 5 })).rows,
    ).toHaveLength(1);
    expect((await client.holds()).pending).toHaveLength(1);
    expect(await client.stamp()).toBe("1.0.0.0.0.1.0.1.0");
    expect(calls[0]).toBe("/api/v1/receipts?before=abc&agent=agent-1&limit=5");
  });

  it("says what kind of failure it was", async () => {
    const { fetch } = fakeFetch({
      "/api/v1/holds": { status: 401, body: {} },
      "/api/v1/mandate": { status: 500, body: {} },
      "/api/v1/agents": { body: { agents: [{ wrong: true }] } },
      "/api/v1/policies": new TypeError("offline"),
    });
    const client = createSlipClient({ fetch, commands });
    const kind = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (e: unknown) => (e instanceof SlipClientError ? e.kind : "other"),
      );
    expect(await kind(client.holds())).toBe("signed-out");
    expect(await kind(client.receipt("nope"))).toBe("not-found");
    expect(await kind(client.mandate())).toBe("server");
    expect(await kind(client.agents())).toBe("invalid");
    expect(await kind(client.policies())).toBe("server");
  });

  it("a command that never answered is unknown, never a thrown error", async () => {
    const client = createSlipClient({ fetch: fakeFetch({}).fetch, commands });
    expect(await client.commands.approveHold("h", 23_900)).toEqual({ status: "unknown" });
    expect(await client.commands.declineHold("h")).toMatchObject({ status: "refused" });
  });
});

describe("SlipProvider", () => {
  it("hands its client to the hooks below it, and refuses hooks without it", () => {
    const client = createSlipClient({ fetch: fakeFetch({}).fetch, commands });
    function Probe() {
      return <p>{useSlip().client === client ? "the client" : "another"}</p>;
    }
    render(
      <SlipProvider client={client}>
        <Probe />
      </SlipProvider>,
    );
    expect(screen.getByText("the client")).toBeDefined();
    expect(() => render(<Probe />)).toThrow(/SlipProvider/);
  });
});

describe("seedSlipQueries", () => {
  it("puts what the server read into the cache the hooks start from", () => {
    const state = seedSlipQueries({ receipts: { page }, holds: { pending: [], decided: [] } });
    const keys = state.queries.map((q) => JSON.stringify(q.queryKey));
    expect(keys).toContain(JSON.stringify(slipKeys.receipts(null)));
    expect(keys).toContain(JSON.stringify(slipKeys.holds));
    expect(state.queries.find((q) => q.queryKey[1] === "receipts")?.state.data).toEqual({
      pages: [page],
      pageParams: [null],
    });
  });
});
