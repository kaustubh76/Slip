import { describe, expect, it } from "vitest";
import { addressOf, DeskLimiter } from "./desks";

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

describe("DeskLimiter", () => {
  it("admits a few desks per address in a window, then asks them to slow down", () => {
    const limiter = new DeskLimiter({ maxDesks: 100, perAddress: 2, windowMs: 60_000 });
    expect(limiter.admit("1.2.3.4", 0)).toBe("ok");
    expect(limiter.admit("1.2.3.4", 1_000)).toBe("ok");
    expect(limiter.admit("1.2.3.4", 2_000)).toBe("slow");
    // Another visitor is unaffected.
    expect(limiter.admit("5.6.7.8", 2_000)).toBe("ok");
    // The window slides.
    expect(limiter.admit("1.2.3.4", 61_000)).toBe("ok");
    expect(limiter.opened).toBe(4);
  });

  it("stops opening desks at the ceiling", () => {
    const limiter = new DeskLimiter({ maxDesks: 2, perAddress: 10, windowMs: 60_000 });
    expect(limiter.admit("a", 0)).toBe("ok");
    expect(limiter.admit("b", 0)).toBe("ok");
    expect(limiter.admit("c", 0)).toBe("full");
  });
});

describe("addressOf", () => {
  it("takes the first proxy hop, then the real IP, else local", () => {
    expect(addressOf(headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(addressOf(headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(addressOf(headers({}))).toBe("local");
  });
});
