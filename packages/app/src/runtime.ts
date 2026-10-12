import { randomUUID } from "node:crypto";
import type { Clock, IdSource, LogFields, Logger } from "@slip/domain";

/** Wall-clock time; `sleep` is a cancellable timer. */
export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms, signal) =>
    new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve(true);
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve(false);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

export const randomIds: IdSource = { uuid: () => randomUUID() };

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** One JSON object per line on stdout/stderr; the apps can swap in pino later. */
export const jsonLogger: Logger = {
  info: (event, fields) => write("info", event, fields),
  warn: (event, fields) => write("warn", event, fields),
  error: (event, fields) => write("error", event, fields),
};

function write(level: string, event: string, fields?: LogFields): void {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...fields });
  if (level === "info") {
    console.log(line);
  } else {
    console.error(line);
  }
}
