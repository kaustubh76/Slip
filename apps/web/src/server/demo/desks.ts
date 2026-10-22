/**
 * Every demo sign-in seeds a desk — an owner, a mandate, three agents and a roll of receipts —
 * into a process that never frees it. These limits keep one demo process healthy: a ceiling on
 * desks in all, and a few per visitor's address in a sliding window. A seeded desk measures about
 * 789 KB of heap, so the ceiling is a memory budget; `render.yaml` sets it for the box it runs on.
 */
export type Admission = "ok" | "full" | "slow";

export class DeskLimiter {
  readonly #maxDesks: number;
  readonly #perAddress: number;
  readonly #windowMs: number;
  #opened = 0;
  readonly #recent = new Map<string, number[]>();

  constructor(options: { maxDesks: number; perAddress: number; windowMs: number }) {
    this.#maxDesks = options.maxDesks;
    this.#perAddress = options.perAddress;
    this.#windowMs = options.windowMs;
  }

  /** Counts a new desk for `address`, or says why not. */
  admit(address: string, nowMs: number): Admission {
    if (this.#opened >= this.#maxDesks) {
      return "full";
    }
    const since = nowMs - this.#windowMs;
    const recent = (this.#recent.get(address) ?? []).filter((at) => at > since);
    if (recent.length >= this.#perAddress) {
      this.#recent.set(address, recent);
      return "slow";
    }
    recent.push(nowMs);
    this.#recent.set(address, recent);
    this.#opened += 1;
    return "ok";
  }

  get opened(): number {
    return this.#opened;
  }
}

/**
 * The demo console's own agent on one desk, kept server-side so the console can shop as it. Not
 * the seeded shopper-1: Slip replays a decision it made minutes ago for the same agent and product,
 * so a console shopping as shopper-1 would only repeat the seed's receipts.
 */
export interface DemoDesk {
  agentId: string;
  apiKey: string;
}

/** The visitor's address as the request says it: the first proxy hop, else "local". */
export function addressOf(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "local";
}
