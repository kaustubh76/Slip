import type { AppConfigInput } from "@slip/app";

/**
 * How a demo paces itself. PayPal's stand-in answers instantly, so without a delay the states
 * written before each PayPal call (INITIATED, CAPTURING, VOIDING) would never be seen: the page
 * polls about once a second and the change stamp is shared for 900 ms, so a call has to take
 * longer than that to show. PayPal's deadline is shortened so a forced timeout resolves in seconds
 * rather than fifteen, and the resolver leaves a payment alone for longer than that deadline, so it
 * never re-sends a call that is still running.
 */
export const DEMO_TIMING = {
  latencyMs: 2_000,
  paypalTimeoutMs: 4_000,
  resolverMinAgeMs: 5_000,
  resolverEveryMs: 5_000,
} as const;

/** The latency asked for in `SLIP_DEMO_LATENCY_MS`, else the demo's default. */
export function demoLatencyMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DEMO_TIMING.latencyMs;
  }
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 60_000 ? n : DEMO_TIMING.latencyMs;
}

/** The application timings a demo runs with. */
export function demoConfig(): AppConfigInput {
  return {
    paypalTimeoutMs: DEMO_TIMING.paypalTimeoutMs,
    resolverMinAgeMs: DEMO_TIMING.resolverMinAgeMs,
  };
}

/**
 * Runs `tick` again `everyMs` after each run finishes — never two at once, never piling up behind a
 * slow run — until the returned stop function is called. A failed run is reported and the next one
 * still happens. The timer does not keep the process alive.
 */
export function every(
  everyMs: number,
  tick: () => Promise<unknown>,
  onError: (error: unknown) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    if (stopped) {
      return;
    }
    timer = setTimeout(async () => {
      try {
        await tick();
      } catch (error) {
        onError(error);
      }
      schedule();
    }, everyMs);
    timer.unref?.();
  };
  schedule();
  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}
