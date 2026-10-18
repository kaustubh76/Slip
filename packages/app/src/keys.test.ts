import { isUuid } from "@slip/domain";
import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  apiKeyFromHeader,
  derivedUuid,
  generateApiKey,
  hashApiKey,
} from "./keys.js";

describe("apiKeyFromHeader", () => {
  it("takes the key out of a Bearer header, and nothing else", () => {
    expect(apiKeyFromHeader("Bearer slip_live_abc")).toBe("slip_live_abc");
    expect(apiKeyFromHeader("bearer   slip_live_abc")).toBe("slip_live_abc");
    for (const header of [null, "", "slip_live_abc", "Basic abc", "Bearer", "Bearer   "]) {
      expect(apiKeyFromHeader(header), String(header)).toBeNull();
    }
  });
});

describe("agent API keys", () => {
  it("a key is shown once; only its hash and a recognisable prefix are kept", () => {
    const issued = generateApiKey();
    expect(issued.key.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(issued.key).toHaveLength(API_KEY_PREFIX.length + 43);
    expect(issued.hash).toBe(hashApiKey(issued.key));
    expect(issued.hash).not.toContain(issued.key.slice(API_KEY_PREFIX.length));
    expect(issued.key.startsWith(issued.prefix)).toBe(true);
    expect(generateApiKey().key).not.toBe(issued.key);
  });

  it("a key pasted with stray whitespace still matches", () => {
    const { key, hash } = generateApiKey();
    expect(hashApiKey(` ${key}\n`)).toBe(hash);
  });
});

describe("derivedUuid", () => {
  it("is the same UUID for the same seed and a different one for another", () => {
    const id = derivedUuid("slip:vault-setup:m1");
    expect(derivedUuid("slip:vault-setup:m1")).toBe(id);
    expect(derivedUuid("slip:vault-setup:m2")).not.toBe(id);
    expect(isUuid(id)).toBe(true);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
