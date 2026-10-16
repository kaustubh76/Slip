import type { Env } from "@slip/db";

/**
 * Demo mode: one long-lived process with the in-memory fakes of Channel3 and PayPal, so Slip can
 * be shown end to end before any sandbox keys exist. It is refused on Vercel, where each request
 * may land on a different instance and the fakes' memory would be split between them.
 */
export function isDemo(env: Env = process.env): boolean {
  return env["SLIP_DEMO"] === "1" && env["VERCEL"] === undefined;
}

/** True when `SLIP_DEMO=1` was asked for but cannot be honoured. */
export function demoRefused(env: Env = process.env): boolean {
  return env["SLIP_DEMO"] === "1" && env["VERCEL"] !== undefined;
}
