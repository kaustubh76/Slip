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

## D14 · 2026-10-11 · Ports live in `@slip/domain`, not in the application layer

`@slip/db` implements the `Store` port and the future `@slip/app` both consumes it and tests
against the in-memory fake. With the port in `app`, `app` and `db` would depend on each other,
which TypeScript project references forbid. Interfaces carry no I/O, so `domain` stays pure.

## D15 · 2026-10-11 · The attempt row is the receipt

One attempt, one receipt: the receipt id is the attempt id, which is also the PayPal
`custom_id` / `invoice_id` of any payment it leads to. Attempts are append-only; the payment and
hold beside them carry the live state. A `Receipt` is `{ attempt, payment, hold }`.

## D16 · 2026-10-11 · The receipt sentence is rendered, not stored; stored check results are versioned

The plain-language sentence is a pure function of the stored decision and live payment state,
so its numbers can never disagree with the record. `check_result_version` lets receipts written by
older code be read exactly when the shape changes.

## D17 · 2026-10-11 · A fenced lease, not an advisory lock, serialises checkouts

A checkout spans Channel3 (5 s), the classifier (5 s) and PayPal (15 s); an advisory lock would
pin a pooled connection that long. A `checkout_leases` row is taken instead, and `record` checks
inside its own transaction that the caller still holds it, so a checkout whose lease lapsed
cannot write a decision. Backstop: a partial unique index allows at most one in-flight payment
(INITIATED, UNKNOWN, PENDING, CAPTURING) per agent and product.

## D18 · 2026-10-11 · PGlite for everyday tests and Docker-free development; real Postgres for races

`pnpm test` runs the full store contract on the in-memory fake and on PGlite (in-process
Postgres 18) with no Docker or environment needed. `pnpm test:pg` runs the same contract plus the
concurrency races on Postgres 18 from docker compose; PGlite has one connection, so races are only
meaningful there. `DATABASE_URL=pglite://<dir>` runs the app locally without Docker.

## D19 · 2026-10-11 · Vault ids are encrypted and bound to their mandate

AES-256-GCM with the mandate id as additional authenticated data, so a ciphertext copied onto
another mandate fails to decrypt. A keyed HMAC (blind index) finds a mandate from a
VAULT.PAYMENT-TOKEN webhook without decrypting rows. Both keys are derived with HKDF from
`SLIP_ENCRYPTION_KEY`; the `v1.` prefix leaves room for rotation.

## D20 · 2026-10-11 · Status moves are applied, unchanged, stale or illegal

PayPal reports a payment through the API response, webhooks and resolver lookups, in any order.
A report behind the stored status (e.g. PENDING after CAPTURED) is a recorded no-op, not an error;
a repeat is `unchanged`; only a genuine contradiction (CAPTURED vs FAILED) throws. The same rule
covers mandates (a late activation after a revoke is ignored) and holds. Every table is acyclic,
and a property test checks that any ordering of reports along a real path converges.

## D21 · 2026-10-11 · Approving a hold that has no PayPal order creates a follow-up attempt

When Channel3 was down or the authorization call failed, a HELD attempt has no order to capture.
Approval re-runs the check and records a new attempt (origin `OWNER_APPROVAL`, rule
`OWNER_APPROVED`, parent = the held attempt) that pays in one step — or is REJECTED if the
re-check finds the agent now overpays. One follow-up per hold; follow-ups are excluded from the
agent's report card and retry cap.

## D22 · 2026-10-11 · One clock: the caller's

Every timestamp a store writes, lease expiry included, comes from the caller's `now`. Decisions
replay exactly, the fake models lease expiry, and there is no mix of application and database
time. Leases last 60 s, far above any plausible clock skew between instances.

## D23 · 2026-10-11 · Payments: a state machine per intent, write-ahead before every PayPal call

CAPTURE (one step) and AUTHORIZE (hold) have separate transition tables. Each status that
precedes a PayPal call is written first — INITIATED (order), CAPTURING (capture a hold), VOIDING
(release one) — with its own PayPal-Request-Id in `payment_operations`, so a crash or timeout is
finished by re-sending the same id, never by a new order. PayPal ids are set once.

## D24 · 2026-10-11 · The database enforces the state machines too

Triggers check every status change against lookup tables (`slip_payment_transitions`, mandate
and hold equivalents), keep identity, amount and PayPal ids immutable, and make attempts,
snapshots, policies, operations and events append-only (UPDATE, DELETE and TRUNCATE refused).
Composite foreign keys pin a payment's amount, agent and product to its attempt's chosen price,
and its intent to the attempt's outcome. A test compares the lookup tables with the domain
tables row for row.

## D25 · 2026-10-11 · `record` re-checks the mandate and policy, and returns the vault id

Inside the transaction that writes the decision, the mandate is read `FOR SHARE` and must be
ACTIVE, and the check's policy version must be the current one; a concurrent revoke or limit
change waits or wins cleanly. The vault id for the charge is decrypted in that same transaction,
so there is no window between "decided" and "allowed to charge".

## D26 · 2026-10-12 · Approving a hold requires an active mandate

The kill switch must stop every movement of money, and a hold approval is one: it starts a
capture. `holds.approve` checks the attempt's mandate is ACTIVE inside its transaction (share lock,
so a concurrent revoke either waits or is seen). Declining and expiring stay allowed after a
revoke because they release money; an approval already made before the revoke repeats as
`unchanged`, and its capture completes.

## D27 · 2026-10-12 · An order-less hold is approved and paid in one transaction

Supersedes the second half of D21. A hold with no live authorization — none was placed (Channel3
was down, no price), or PayPal failed or voided it before any capture — is approved by
`holds.approveWithFollowUp`: the hold becomes APPROVED in the same transaction that records the
OWNER_APPROVAL attempt and its INITIATED one-step payment, after every `record` check (lease,
agent, ACTIVE mandate, current policy). If any check fails, nothing is written and the hold stays
PENDING, so there is no "approved but not yet paid" state to recover from, and the crash-recovery
listing is gone. `attempts.record` refuses OWNER_APPROVAL attempts.

A hold whose capture was attempted (approved, then the capture was declined) is never followed
up: that approval was spent on the capture, and a follow-up would charge again without asking. A
live authorization is approved by capturing it; an unsettled one is not ready. The follow-up is
always PAID by OWNER_APPROVED: a re-check that rejects is refused by the application, not recorded.

## D28 · 2026-10-12 · Open holds are found at any age; half-done revokes are findable

Checkout dedupe looks at recent attempts (10 minutes), but a PENDING hold can be two days old. If
dedupe only saw recent ones, a second HELD attempt would place a second authorization, and an owner
approving both would pay twice. `holds.listOpen(agent, product)` returns PENDING holds at any age.
`holds.listPendingOnRevokedMandates` lets the resolver finish a revoke that stopped before
declining its holds, so their authorizations are voided rather than left to expire.

## D29 · 2026-10-12 · Deleting the PayPal token after a revoke is tracked until confirmed

Revoking stops Slip at once (the store refuses every charge and approval), but the vaulted payment
method also has to be deleted at PayPal. That call can fail, and once a mandate is REVOKED
`vaultIdForCharge` returns nothing, so a failed deletion used to be lost. `vault_deleted_at` (set
once, only on a REVOKED mandate that had a vault id) records PayPal's confirmation;
`vaultIdForDeletion` releases the vault id for deletion only — never for a charge — until then,
and `listAwaitingVaultDeletion` lets the resolver retry.

## D30 · 2026-10-12 · External services are ports whose failures are results

Channel3, PayPal and the steering classifier are interfaces in `@slip/domain/ports`; fakes now,
real adapters in later increments. Every call takes an `AbortSignal`, and every expected failure is
a result, not an exception: `unknown` means "may or may not have happened", and the caller keeps
its write-ahead status and finishes with the same request id. A declined capture says nothing about
the authorization, so the caller asks before voiding. Webhook verification takes the raw body and
headers; interpretation is pure so stored events can be replayed. The clock can `sleep`, so
deadlines run on injected time and tests need no fake timers (which stall database drivers).

## D31 · 2026-10-12 · Checkout gatekeeping: what counts as a repeat

Resolves the ambiguities the requirements sweep found in the spec and diagram:

- A second call while another checkout holds the (agent, product) lease is refused as `BUSY`; the
  agent may call again. Nothing is recorded.
- Replayed, not repeated: a PAID attempt whose payment is CAPTURED or still in flight within 10
  minutes (a FAILED payment does not block a retry); any open hold, at any age (D28); the same
  offer — normalised URL and variant — REJECTED within 10 minutes **under the same policy
  version**, so a loosened policy gets a fresh check.
- The retry cap is at most 4 agent attempts per product per rolling hour (the first plus "3
  retries"); owner-approval follow-ups do not count. A capped call is refused and not recorded.
- The agent is identified by its key, never by a field; any price it sends is dropped.
