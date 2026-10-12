import type { Clock, IdSource } from "../ports/runtime.js";

interface Sleeper {
  wakeAt: number;
  resolve: (elapsed: boolean) => void;
}

/**
 * A clock that only moves when told to. `sleep` waits for `advance`, so a test decides exactly
 * when a deadline passes — without fake timers, which would also stall real I/O such as PGlite.
 */
export class ManualClock implements Clock {
  #now: number;
  #sleepers: Sleeper[] = [];

  constructor(start: Date) {
    this.#now = start.getTime();
  }

  now(): Date {
    return new Date(this.#now);
  }

  sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return Promise.resolve(false);
    }
    if (ms <= 0) {
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const sleeper: Sleeper = { wakeAt: this.#now + ms, resolve };
      this.#sleepers.push(sleeper);
      signal?.addEventListener(
        "abort",
        () => {
          this.#sleepers = this.#sleepers.filter((s) => s !== sleeper);
          resolve(false);
        },
        { once: true },
      );
    });
  }

  /** Moves time forward and wakes every sleeper whose time has come, earliest first. */
  advance(ms: number): void {
    this.#now += ms;
    const due = this.#sleepers
      .filter((s) => s.wakeAt <= this.#now)
      .sort((a, b) => a.wakeAt - b.wakeAt);
    this.#sleepers = this.#sleepers.filter((s) => s.wakeAt > this.#now);
    for (const sleeper of due) {
      sleeper.resolve(true);
    }
  }

  /** Jumps to a point in time (forward only). */
  set(date: Date): void {
    if (date.getTime() < this.#now) {
      throw new Error("ManualClock only moves forward");
    }
    this.advance(date.getTime() - this.#now);
  }

  /** How many `sleep` calls are waiting. */
  get sleeping(): number {
    return this.#sleepers.length;
  }
}

/**
 * Runs real asynchronous work (store queries, fake network calls) to completion while advancing
 * the manual clock by `stepMs` whenever something is asleep — how a test lets a deadline pass
 * mid-call. Fails if the promise has not settled after `maxSteps` turns of the event loop.
 */
export async function driveUntilSettled<T>(
  clock: ManualClock,
  promise: Promise<T>,
  options: { stepMs?: number; maxSteps?: number } = {},
): Promise<T> {
  const stepMs = options.stepMs ?? 1_000;
  const maxSteps = options.maxSteps ?? 10_000;
  let settled = false;
  const tracked = promise.finally(() => {
    settled = true;
  });
  for (let step = 0; step < maxSteps && !settled; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!settled && clock.sleeping > 0) {
      clock.advance(stepMs);
    }
  }
  if (!settled) {
    throw new Error(`driveUntilSettled: still pending after ${maxSteps} steps`);
  }
  return tracked;
}

/** Ids from a counter, shaped as v4 UUIDs: deterministic across runs. */
export class SequentialIds implements IdSource {
  #next: number;
  readonly #prefix: string;

  constructor(prefix = "00000000-0000-4000-8000") {
    this.#next = 1;
    this.#prefix = prefix;
  }

  uuid(): string {
    const value = this.#next;
    this.#next += 1;
    return `${this.#prefix}-${value.toString(16).padStart(12, "0")}`;
  }
}
