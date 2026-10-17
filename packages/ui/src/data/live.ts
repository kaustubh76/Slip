"use client";

import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { SlipClientError } from "./client.js";
import { slipKeys } from "./keys.js";
import { useSlip } from "./provider.js";

/**
 * Live updates. The server keeps a change stamp per mandate — counters that only grow (receipts,
 * payment events, PayPal ids, decided holds, the limits' version, the mandate's step, agents) —
 * and this hook reads it about once a second. When a counter moves, exactly the queries that
 * counter can affect are read again; nothing is pushed into the cache, so what the page shows is
 * always what the server returned (D49). Server-sent events can replace the polling later; the
 * stamp and what each counter refreshes stay the same.
 */

/** The stamp's counters, in the order of `stampToken` in `@slip/domain`. */
export const STAMP_COUNTERS = [
  "attempts",
  "paymentEvents",
  "paypalIds",
  "decidedHolds",
  "policyVersion",
  "mandateStep",
  "vaultDeleted",
  "agents",
  "revokedAgents",
] as const;
export type StampCounter = (typeof STAMP_COUNTERS)[number];

/** What each counter can change on the owner's pages. */
const AFFECTS: Readonly<Record<StampCounter, readonly QueryKey[]>> = {
  attempts: [slipKeys.receiptsAll, slipKeys.holds, slipKeys.mandate, slipKeys.agents],
  paymentEvents: [slipKeys.receiptsAll, slipKeys.receiptAll, slipKeys.holds, slipKeys.agents],
  paypalIds: [slipKeys.receiptsAll, slipKeys.receiptAll, slipKeys.holds],
  decidedHolds: [slipKeys.holds, slipKeys.receiptsAll, slipKeys.receiptAll, slipKeys.mandate],
  policyVersion: [slipKeys.policies, slipKeys.mandate],
  mandateStep: [slipKeys.mandate, slipKeys.holds],
  vaultDeleted: [slipKeys.mandate],
  agents: [slipKeys.agents, slipKeys.mandate],
  revokedAgents: [slipKeys.agents],
};

/** Which counters differ between two stamp tokens; every counter when they cannot be compared. */
export function movedCounters(before: string, after: string): StampCounter[] {
  const a = before.split(".");
  const b = after.split(".");
  if (a.length !== STAMP_COUNTERS.length || b.length !== STAMP_COUNTERS.length) {
    return before === after ? [] : [...STAMP_COUNTERS];
  }
  return STAMP_COUNTERS.filter((_, i) => a[i] !== b[i]);
}

/** Reads again what these counters affect, without cancelling reads already under way. */
export async function refreshFor(
  queries: QueryClient,
  moved: readonly StampCounter[],
): Promise<void> {
  const keys = new Map<string, QueryKey>();
  for (const counter of moved) {
    for (const key of AFFECTS[counter]) {
      keys.set(JSON.stringify(key), key);
    }
  }
  await Promise.all(
    [...keys.values()].map((queryKey) =>
      queries.invalidateQueries({ queryKey, refetchType: "active" }, { cancelRefetch: false }),
    ),
  );
}

export type LiveMode = "live" | "offline" | "signed-out";

export interface LiveState {
  mode: LiveMode;
  /** When the stamp was last read successfully (ms since the epoch), or null. */
  lastCheckAt: number | null;
  /** When something last changed (ms since the epoch), or null. */
  lastChangeAt: number | null;
}

const FLUSH_AFTER_MS = 250;
const FLUSH_AT_MOST_MS = 1_000;

/**
 * Keeps the page current. `initialToken` is the stamp the server read before it read the page's
 * data, so a change in between is caught on the first look rather than missed.
 */
export function useLive(
  options: { initialToken?: string | null; everyMs?: number } = {},
): LiveState {
  const { client, onEvent } = useSlip();
  const queries = useQueryClient();
  const everyMs = options.everyMs ?? 1_000;
  const [state, setState] = useState<LiveState>({
    mode: "live",
    lastCheckAt: null,
    lastChangeAt: null,
  });
  const last = useRef<string | null>(options.initialToken ?? null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Changes waiting to be refreshed, batched: a burst of events is one round of reads.
    const pending = new Set<StampCounter>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let firstPendingAt = 0;

    const flush = () => {
      flushTimer = undefined;
      const moved = [...pending];
      pending.clear();
      if (moved.length > 0) {
        void refreshFor(queries, moved);
      }
    };
    const queue = (moved: readonly StampCounter[]) => {
      const now = Date.now();
      if (pending.size === 0) {
        firstPendingAt = now;
      }
      for (const counter of moved) {
        pending.add(counter);
      }
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
      }
      const waited = now - firstPendingAt;
      flushTimer = setTimeout(
        flush,
        Math.max(0, Math.min(FLUSH_AFTER_MS, FLUSH_AT_MOST_MS - waited)),
      );
    };

    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";

    const tick = async () => {
      timer = undefined;
      if (stopped) {
        return;
      }
      if (visible()) {
        try {
          const token = await client.stamp();
          const previous = last.current;
          last.current = token;
          const now = Date.now();
          if (previous !== null && previous !== token) {
            const moved = movedCounters(previous, token);
            queue(moved);
            onEventRef.current?.({ type: "changed", moved, token });
            setState({ mode: "live", lastCheckAt: now, lastChangeAt: now });
          } else {
            setState((s) => ({ ...s, mode: "live", lastCheckAt: now }));
          }
        } catch (error) {
          const signedOut = error instanceof SlipClientError && error.kind === "signed-out";
          setState((s) => ({ ...s, mode: signedOut ? "signed-out" : "offline" }));
          if (signedOut) {
            return;
          }
        }
      }
      if (!stopped) {
        timer = setTimeout(tick, everyMs);
      }
    };

    const onVisible = () => {
      if (visible() && timer !== undefined) {
        clearTimeout(timer);
        void tick();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    void tick();
    return () => {
      stopped = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flush();
      }
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [client, queries, everyMs]);

  return state;
}
