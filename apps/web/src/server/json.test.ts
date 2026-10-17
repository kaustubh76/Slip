import { describe, expect, it } from "vitest";
import { answer, jsonRoute } from "./json";

describe("jsonRoute", () => {
  it("answers JSON that is never cached", async () => {
    const route = jsonRoute(async () => answer(200, { ok: true }));
    const response = await route();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("turns a throw into a logged 500 with a plain message, never a stack", async () => {
    const seen: unknown[] = [];
    const route = jsonRoute(
      async () => {
        throw new Error("database went away at /very/secret/path.ts:12");
      },
      (error) => seen.push(error),
    );
    const response = await route();
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.status).toBe("error");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(seen).toHaveLength(1);
  });
});
