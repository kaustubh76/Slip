import { describe, expect, it } from "vitest";
import { demoRefused, isDemo } from "./demo";

describe("demo mode", () => {
  it("is on only when asked for", () => {
    expect(isDemo({ SLIP_DEMO: "1" })).toBe(true);
    expect(isDemo({})).toBe(false);
    expect(isDemo({ SLIP_DEMO: "0" })).toBe(false);
    expect(isDemo({ SLIP_DEMO: "true" })).toBe(false);
  });

  it("is refused where the fakes' memory would be split across instances", () => {
    expect(isDemo({ SLIP_DEMO: "1", VERCEL: "1" })).toBe(false);
    expect(demoRefused({ SLIP_DEMO: "1", VERCEL: "1" })).toBe(true);
    expect(demoRefused({ SLIP_DEMO: "1" })).toBe(false);
    expect(demoRefused({ VERCEL: "1" })).toBe(false);
  });
});
