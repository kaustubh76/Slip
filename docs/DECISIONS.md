# Decisions

One entry per decision that is not derivable from the spec or the code. Newest at the bottom.
Each entry: what was decided, why, and what it changes.

## D1 · 2026-10-11 · The execution-flow diagram wins over `SPEC.md` (v4)

The diagram is labelled "based on spec v5" and lists its own changes; the written spec is v4.
Where the two disagree, the code follows the diagram. The differences are D2–D4 below.

## D2 · 2026-10-11 · Gap > 1 % with a commission conflict → HELD, not REJECTED

Spec v4 §5 rejected on "conflict or steering". The diagram's rule R5 holds for a human with
both commission rates shown. Reason: a conflict is a signal about the platform, not proof the
agent chose badly; a human should see it. Steering (R3) still rejects.

## D3 · 2026-10-11 · A commission conflict needs both rates above zero

Channel3's `max_commission_rate` defaults to 0 when unknown, so "best pays 0 %, chosen pays 8 %"
cannot be told apart from "best's rate is unknown". Rule R5 requires `chosen > best > 0`.
Rates outside [0, 1] or missing are stored as `null` and never produce a conflict.

## D4 · 2026-10-11 · The agent's `reason` is stored and shown; no rule reads it

Spec v4 §5 let the steering flag fire when the reason "cites a badge or listing claim". The
diagram drops that: the reason is untrusted text the agent controls, so it cannot change an
outcome. The classifier reads only the listing text and what Slip's own search tool showed.

## D5 · 2026-10-11 · The chosen offer counts as one of the comparable offers

`comparable` includes the chosen offer when it qualifies. Consequences: `gap_abs ≥ 0` is an
invariant; rule R2 ("fewer than 2 comparable") means "the chosen offer plus at least one
competitor", which matches gate G1's "2+ offers" wording; an agent that picks the only in-stock
offer is HELD, not PAID.

## D6 · 2026-10-11 · Known-bad chosen offer → REJECTED; unknown data → HELD

A chosen offer that is out of stock or used is `CHOSEN_UNAVAILABLE` → REJECTED (there is nothing
to pay for). A chosen offer whose condition is `null`, whose currency is not USD, or whose price
could not be parsed is `CHOSEN_UNVERIFIED` → HELD (unknown data goes to a human). Phase 0 will
measure how often Channel3 returns `condition: null`.

## D7 · 2026-10-11 · Percent thresholds are integer hundredths of a percent

`5 %` is stored as `500` so an owner can set `7.5 %`. Comparisons are integer:
`gap_abs · 10 000 > threshold · best_listed`. With prices capped at $1,000,000 and thresholds
at 1000 %, products stay far below 2^53. The UI shows percent and dollars only.

## D8 · 2026-10-11 · Best offer tie-break: price, then commission, then URL

Among comparable offers the best is the first after sorting by (price asc, commission bps asc
with unknown last, url asc). This makes the result independent of the order Channel3 returns
offers in, and resolves a tie at the lowest price to the lower-commission store.

## D9 · 2026-10-11 · `CheckResult.ruleCodes` lists every rule that tripped

`ruleCode` is the deciding rule (first match). `ruleCodes` also records later rules that would
have fired, so the report card counts "steered" even when "overpaid" decided, and a receipt can
mention a commission conflict alongside an overpayment.

## D10 · 2026-10-11 · MCP TypeScript SDK v2

`@modelcontextprotocol/server` 2.x is the stable line (spec 2026-07-28, zod 4, built-in bearer
auth). The v1 package (`@modelcontextprotocol/sdk`) is maintenance-only and is not used.

## D11 · 2026-10-11 · Steering classifier model: `claude-opus-5-5`

Chosen by the owner over `claude-haiku-5-5`. Run at `effort: "low"`, `max_tokens` 256, request
timeout 5 s, no retries; any error, refusal or unparsable output is "no answer" → HELD (R4a).

## D12 · 2026-10-11 · The Channel3 adapter uses `fetch` + zod, not the SDK

Snapshots are our own schema and fixtures are raw JSON recorded from the API, so the adapter
validates responses itself with a 5 s timeout. `@channel3/sdk` may still be used by `study/`.

## D13 · 2026-10-11 · Unparsable offer prices become `priceCents: null`

Channel3 prices are JSON floats in dollars. Missing, zero, negative, or >2-decimal values are
kept in the snapshot as `null` rather than dropped, so the check can say *why* an offer was not
compared (competitor → excluded; chosen → `CHOSEN_UNVERIFIED`).
