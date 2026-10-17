"use client";

import { useSyncExternalStore } from "react";

/**
 * One ticking clock per interval for the whole page, however many countdowns read it. During a
 * server render and the first client render it reports the time the server rendered at, so the
 * countdown in the HTML and the one React hydrates agree; it starts ticking right after.
 */

interface Ticker {
  now: number;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | null;
}

const tickers = new Map<number, Ticker>();

function tickerFor(everyMs: number): Ticker {
  let ticker = tickers.get(everyMs);
  if (ticker === undefined) {
    ticker = { now: Date.now(), listeners: new Set(), timer: null };
    tickers.set(everyMs, ticker);
  }
  return ticker;
}

function subscribe(everyMs: number, listener: () => void): () => void {
  const ticker = tickerFor(everyMs);
  ticker.listeners.add(listener);
  if (ticker.timer === null) {
    ticker.now = Date.now();
    ticker.timer = setInterval(() => {
      ticker.now = Date.now();
      for (const notify of ticker.listeners) {
        notify();
      }
    }, everyMs);
  }
  return () => {
    ticker.listeners.delete(listener);
    if (ticker.listeners.size === 0 && ticker.timer !== null) {
      clearInterval(ticker.timer);
      ticker.timer = null;
    }
  };
}

/** The current time in ms, updated every `everyMs`; `serverNow` is what the server rendered with. */
export function useClock(everyMs = 1_000, serverNow?: number): number {
  return useSyncExternalStore(
    (listener) => subscribe(everyMs, listener),
    () => tickerFor(everyMs).now,
    () => serverNow ?? tickerFor(everyMs).now,
  );
}
