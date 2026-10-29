import { describe, expect, it } from "vitest";
import { connectDetails, KEY_PLACEHOLDER } from "./connect";

/**
 * The snippets an owner copies. They are tested as strings because that is what gets pasted: a
 * wrong header name or a missing `/api/mcp` is a client that silently never connects, and the
 * owner has no way to tell which half is wrong.
 */

const KEY = "slip_live_abcdef0123456789";

describe("where an agent connects", () => {
  it("builds the endpoint from the deployment's own address", () => {
    expect(connectDetails({ base: "https://slip.example" }).endpoint).toBe(
      "https://slip.example/api/mcp",
    );
    expect(connectDetails({ base: "http://localhost:3000" }).endpoint).toBe(
      "http://localhost:3000/api/mcp",
    );
  });

  it("does not double the slash when the address carries one", () => {
    const details = connectDetails({ base: "https://slip.example/" });
    expect(details.endpoint).toBe("https://slip.example/api/mcp");
    expect(details.restEndpoint).toBe("https://slip.example/api/v1/agent/checkout");
  });

  it("offers the plain-HTTP endpoint too, for an agent that does not speak MCP", () => {
    expect(connectDetails({ base: "https://slip.example" }).restEndpoint).toBe(
      "https://slip.example/api/v1/agent/checkout",
    );
  });
});

describe("the key, which is known exactly once", () => {
  it("carries the real key at the moment it is issued", () => {
    const details = connectDetails({ base: "https://slip.example", apiKey: KEY });
    expect(details.carriesKey).toBe(true);
    expect(details.command).toContain(`Authorization: Bearer ${KEY}`);
    expect(JSON.parse(details.config)).toEqual({
      mcpServers: {
        slip: {
          url: "https://slip.example/api/mcp",
          headers: { Authorization: `Bearer ${KEY}` },
        },
      },
    });
  });

  it("names an environment variable once the key can no longer be shown", () => {
    for (const apiKey of [undefined, ""]) {
      const details = connectDetails({ base: "https://slip.example", apiKey });
      expect(details.carriesKey).toBe(false);
      expect(details.command).toContain(KEY_PLACEHOLDER);
      expect(details.config).toContain(KEY_PLACEHOLDER);
      // Nothing may invent a key: a snippet that looks complete but is not would be worse than one
      // that plainly asks for the value.
      expect(details.command).not.toContain("slip_live_");
      expect(details.config).not.toContain("slip_live_");
    }
  });

  it("never puts the key in the url, only in the header", () => {
    const details = connectDetails({ base: "https://slip.example", apiKey: KEY });
    expect(details.endpoint).not.toContain(KEY);
    expect(details.restEndpoint).not.toContain(KEY);
    expect(JSON.parse(details.config).mcpServers.slip.url).not.toContain(KEY);
  });

  it("gives both forms the same endpoint and the same key, so neither can drift", () => {
    const details = connectDetails({ base: "https://slip.example", apiKey: KEY });
    const fromConfig = JSON.parse(details.config).mcpServers.slip;
    expect(details.command).toContain(fromConfig.url);
    expect(details.command).toContain(fromConfig.headers.Authorization);
  });
});
