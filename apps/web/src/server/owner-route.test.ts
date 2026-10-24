import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerContext } from "./owner";

/**
 * The wrapper every owner endpoint is built on. What is checked here is the order of its three
 * gates: no session is 401 before anything else, a write from another site is 403, and a read is
 * never asked where it came from (D83).
 */

const { currentOwner } = vi.hoisted(() => ({ currentOwner: vi.fn() }));
vi.mock("./owner", () => ({ currentOwner }));
vi.mock("./runtime", () => ({ deps: async () => ({ log: { error: () => {} } }) }));

const { ownerRoute } = await import("./owner-route");

const signedIn = {
  deps: { config: { publicBaseUrl: "https://slip.example" } },
} as unknown as OwnerContext;

const ask = async (method: string, origin: string | null) => {
  let reached = false;
  const route = ownerRoute(async () => {
    reached = true;
    return { status: 200, body: { ok: true } };
  });
  const response = await route(
    new Request("https://slip.example/api/v1/holds/x/decline", {
      method,
      ...(origin === null ? {} : { headers: { origin } }),
    }),
    {},
  );
  return { status: response.status, reached, body: await response.json() };
};

describe("ownerRoute", () => {
  beforeEach(() => {
    currentOwner.mockReset();
    currentOwner.mockResolvedValue(signedIn);
  });

  it("answers 401 without a session, before it asks anything else", async () => {
    currentOwner.mockResolvedValue(null);
    const answer = await ask("POST", "https://evil.example");
    expect(answer.status).toBe(401);
    // Not 403: a request with no session has not been refused for where it came from.
    expect(answer.body).toMatchObject({ reason: "UNAUTHENTICATED" });
    expect(answer.reached).toBe(false);
  });

  it("refuses a write that says it came from another site", async () => {
    const answer = await ask("POST", "https://evil.example");
    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ reason: "FOREIGN_ORIGIN" });
    // The handler never ran, so nothing was decided and no money moved.
    expect(answer.reached).toBe(false);
  });

  it("lets Slip's own pages write", async () => {
    expect(await ask("POST", "https://slip.example")).toMatchObject({ status: 200, reached: true });
  });

  it("lets a caller that sends no origin write, because that is every server-to-server client", async () => {
    expect(await ask("POST", null)).toMatchObject({ status: 200, reached: true });
  });

  it("never asks a read where it came from", async () => {
    // A cross-site page cannot read the answer anyway, and the reads change nothing.
    expect(await ask("GET", "https://evil.example")).toMatchObject({ status: 200, reached: true });
  });
});
