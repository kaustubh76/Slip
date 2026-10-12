import type { Clock } from "@slip/domain";

export type Deadlined<T> = { timedOut: false; value: T } | { timedOut: true };

/**
 * Runs `work` with a deadline on the injected clock. If time runs out first, `work`'s signal is
 * aborted and the result is `timedOut` — whatever `work` does afterwards is ignored (a well-behaved
 * adapter stops; a stuck one is left to finish on its own). If `work` throws, so does this: an
 * adapter bug is not a timeout. The deadline timer is cancelled as soon as `work` finishes.
 */
export async function withDeadline<T>(
  clock: Clock,
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<Deadlined<T>> {
  const workSignal = new AbortController();
  const timerSignal = new AbortController();
  const running = work(workSignal.signal).then((value) => ({ timedOut: false as const, value }));
  const deadline = clock
    .sleep(ms, timerSignal.signal)
    .then((elapsed) => (elapsed ? ({ timedOut: true } as const) : null));
  try {
    const first = await Promise.race([running, deadline]);
    if (first === null) {
      // The timer was cancelled without elapsing: only `running` can have settled.
      return await running;
    }
    if (first.timedOut) {
      workSignal.abort();
      running.catch(() => {});
    }
    return first;
  } finally {
    timerSignal.abort();
  }
}
