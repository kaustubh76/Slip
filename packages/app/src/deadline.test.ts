import { driveUntilSettled, ManualClock, NOW } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { withDeadline } from "./deadline.js";
import { systemClock } from "./runtime.js";

describe("withDeadline", () => {
  it("returns the work's value when it finishes in time, and cancels the timer", async () => {
    const clock = new ManualClock(NOW);
    expect(await withDeadline(clock, 5_000, async () => 42)).toEqual({
      timedOut: false,
      value: 42,
    });
    expect(clock.sleeping).toBe(0);
  });

  it("aborts the work when the deadline passes first", async () => {
    const clock = new ManualClock(NOW);
    let aborted = false;
    const result = driveUntilSettled(
      clock,
      withDeadline(
        clock,
        15_000,
        (signal) =>
          new Promise<string>((resolve) =>
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve("too late");
            }),
          ),
      ),
      { stepMs: 5_000 },
    );
    expect(await result).toEqual({ timedOut: true });
    expect(aborted).toBe(true);
    expect(clock.now().getTime() - NOW.getTime()).toBe(15_000);
  });

  it("an adapter that throws is not a timeout", async () => {
    const clock = new ManualClock(NOW);
    await expect(
      withDeadline(clock, 5_000, async () => {
        throw new Error("adapter bug");
      }),
    ).rejects.toThrow("adapter bug");
    expect(clock.sleeping).toBe(0);
  });

  it("works on the system clock", async () => {
    expect(await withDeadline(systemClock, 1_000, async () => "fast")).toEqual({
      timedOut: false,
      value: "fast",
    });
    const slow = await withDeadline(
      systemClock,
      10,
      (signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve("x"))),
    );
    expect(slow).toEqual({ timedOut: true });
  });
});

describe("systemClock.sleep", () => {
  it("resolves false when aborted", async () => {
    const controller = new AbortController();
    const sleeping = systemClock.sleep(60_000, controller.signal);
    controller.abort();
    expect(await sleeping).toBe(false);
  });
});
