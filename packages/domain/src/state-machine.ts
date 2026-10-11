/**
 * Shared machinery for every status column Slip keeps (payments, mandates, holds). Each table is
 * an explicit, acyclic list of allowed moves. A requested move is classified rather than simply
 * allowed or refused, because PayPal tells us about the same payment through several channels
 * (the API response, a webhook, the resolver's lookup) and they arrive in any order:
 *
 * - `applied`   — a legal move forward; the store writes it.
 * - `unchanged` — already in that status; a repeat of the same news.
 * - `stale`     — the stored status is already *past* the requested one (e.g. a late webhook says
 *                 PENDING after we recorded CAPTURED); ignored, never an error.
 * - `illegal`   — neither: two sources genuinely disagree (CAPTURED vs FAILED). The store refuses
 *                 and a human must look.
 */
export type Transitions<S extends string> = Readonly<Record<S, readonly S[]>>;

export type TransitionResult = "applied" | "unchanged" | "stale";

export function canMove<S extends string>(table: Transitions<S>, from: S, to: S): boolean {
  return table[from].includes(to);
}

/** True when `to` can be reached from `from` in one or more legal moves. */
export function isReachable<S extends string>(table: Transitions<S>, from: S, to: S): boolean {
  const seen = new Set<S>();
  const queue: S[] = [...table[from]];
  while (queue.length > 0) {
    const next = queue.shift() as S;
    if (next === to) {
      return true;
    }
    if (!seen.has(next)) {
      seen.add(next);
      queue.push(...table[next]);
    }
  }
  return false;
}

export function classifyMove<S extends string>(
  table: Transitions<S>,
  from: S,
  to: S,
): TransitionResult | "illegal" {
  if (from === to) {
    return "unchanged";
  }
  if (canMove(table, from, to)) {
    return "applied";
  }
  if (isReachable(table, to, from)) {
    return "stale";
  }
  return "illegal";
}

/** Terminal statuses: no move leaves them. */
export function terminalStatuses<S extends string>(table: Transitions<S>): S[] {
  return (Object.keys(table) as S[]).filter((status) => table[status].length === 0);
}

/** For tests and table definitions: every table must be acyclic so "stale" is well defined. */
export function isAcyclic<S extends string>(table: Transitions<S>): boolean {
  return (Object.keys(table) as S[]).every((status) => !isReachable(table, status, status));
}
