import "server-only";
import type { AppDeps } from "@slip/app";
import { type ChangeStamp, type MandateId, stampToken } from "@slip/domain";

/**
 * The change stamp, shared for a moment. Every open tab polls, and a PGlite database has one
 * connection, so readings within the same short window are answered from the last one: ten tabs
 * cost one query a second, not ten.
 *
 * It is only ever stale by that window, and it only ever lags — never reports a change that has
 * not happened — so a page may see a new receipt a fraction of a second late and never early.
 */

export const STAMP_WINDOW_MS = 900;

interface Cached {
  at: number;
  /** The reading itself, so tabs arriving together share one query rather than racing. */
  stamp: Promise<ChangeStamp>;
}

const KEY = Symbol.for("slip.web.stamps");
const holder = globalThis as typeof globalThis & { [KEY]?: Map<string, Cached> };

export function stampFor(deps: AppDeps, mandateId: string): Promise<ChangeStamp> {
  holder[KEY] ??= new Map();
  const cache = holder[KEY];
  const now = deps.clock.now().getTime();
  const cached = cache.get(mandateId);
  if (cached !== undefined && now - cached.at < STAMP_WINDOW_MS) {
    return cached.stamp;
  }
  const stamp = deps.store.live.stamp(mandateId as MandateId);
  cache.set(mandateId, { at: now, stamp });
  // A failed reading is not worth keeping: the next poll should try again.
  return stamp.catch((error: unknown) => {
    if (cache.get(mandateId)?.stamp === stamp) {
      cache.delete(mandateId);
    }
    throw error;
  });
}

export async function stampTokenFor(deps: AppDeps, mandateId: string): Promise<string> {
  return stampToken(await stampFor(deps, mandateId));
}

/** For tests: forget what was cached. */
export function clearStampCache(): void {
  holder[KEY]?.clear();
}
