import { describe, expect, it } from "vitest";
import { isUuid } from "../ids.js";
import { driveUntilSettled, ManualClock, SequentialIds } from "./clock.js";
import { NOW } from "./index.js";

describe("ManualClock", () => {
  it("only moves when advanced, waking sleepers in order", async () => {
    const clock = new ManualClock(NOW);
    const woke: string[] = [];
    const a = clock.sleep(5_000).then((v) => woke.push(`a:${v}`));
    const b = clock.sleep(1_000).then((v) => woke.push(`b:${v}`));
    expect(clock.sleeping).toBe(2);
    clock.advance(999);
    await Promise.resolve();
    expect(woke).toEqual([]);
    clock.advance(4_001);
    await Promise.all([a, b]);
    expect(woke).toEqual(["b:true", "a:true"]);
    expect(clock.now().getTime() - NOW.getTime()).toBe(5_000);
  });

  it("an aborted sleep resolves false and is forgotten", async () => {
    const clock = new ManualClock(NOW);
    const controller = new AbortController();
    const sleep = clock.sleep(1_000, controller.signal);
    controller.abort();
    expect(await sleep).toBe(false);
    expect(clock.sleeping).toBe(0);
    expect(await clock.sleep(1_000, controller.signal)).toBe(false);
  });

  it("refuses to go back in time", () => {
    const clock = new ManualClock(NOW);
    expect(() => clock.set(new Date(NOW.getTime() - 1))).toThrow();
  });
});

describe("driveUntilSettled", () => {
  it("advances the clock while work is waiting on it", async () => {
    const clock = new ManualClock(NOW);
    const work = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 0)); // real I/O in the middle
      const elapsed = await clock.sleep(15_000);
      return elapsed ? "deadline passed" : "aborted";
    })();
    expect(await driveUntilSettled(clock, work, { stepMs: 5_000 })).toBe("deadline passed");
    expect(clock.now().getTime() - NOW.getTime()).toBe(15_000);
  });

  it("does not move time for work that never sleeps", async () => {
    const clock = new ManualClock(NOW);
    expect(await driveUntilSettled(clock, Promise.resolve(42))).toBe(42);
    expect(clock.now()).toEqual(NOW);
  });
});

describe("SequentialIds", () => {
  it("hands out distinct, valid UUIDs", () => {
    const ids = new SequentialIds();
    const a = ids.uuid();
    const b = ids.uuid();
    expect(a).not.toBe(b);
    expect(isUuid(a) && isUuid(b)).toBe(true);
  });
});
