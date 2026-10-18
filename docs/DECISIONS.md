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

## D32 · 2026-10-12 · Where the check's inputs come from, and what happens when they don't

- A snapshot still fresh under the owner's policy is reused; otherwise Channel3 is asked, within 5
  seconds, and the answer saved with its raw response.
- A product Channel3 says does not exist becomes a zero-offer snapshot whose variant mirrors the
  request, so the check reports "offer not found" (REJECTED) instead of holding. Any other failure
  (down, out of credits, rate limited, timeout) falls back to the last snapshot, stale or none, and
  R1 holds the purchase.
- The steering classifier is asked only when the check needs it, within 5 seconds. A listing with
  no text is not sent — it cannot instruct an agent. A timeout, error or refusal is NO_ANSWER,
  which R4a holds. After a policy change the earlier answer is reused, not asked again.
- HELD reserves money (AUTHORIZE) only when there is a USD price to reserve; otherwise the hold has
  no order and approval pays in one step (D27).

## D33 · 2026-10-12 · An owner approves an amount, and overrides holds, not rejections

- The owner sees what approving charges (`previewApproval`) and approves that amount
  (`expectedAmountCents`). A reserved hold charges exactly what was reserved. A hold with nothing
  reserved is checked again on current prices; if the price is not the one shown, approval is
  refused with the new amount (`PRICE_CHANGED`) and nothing is written.
- The re-check may hold again (over the cap, too few offers, no classifier answer) — the owner's
  approval covers that. It may not reject (overpaid, steered, offer gone): approval is refused, and
  there must be a fresh US-dollar price, or it is `PRICES_UNAVAILABLE`.
- The follow-up keeps the re-check's findings behind `OWNER_APPROVED` in `ruleCodes`, so the
  receipt says both who decided and what the check saw.
- The re-check and the follow-up run under the (agent, product) checkout lease; a running agent
  checkout makes approval `BUSY`.
- Holds are scoped to their owner: someone else's hold, an attempt with no hold and a malformed id
  are all "not found". Declining is allowed after a revoke, since it releases money; approving is
  not.

## D34 · 2026-10-12 · The resolver finishes what requests could not, in a fixed order

Run on a schedule; every action is idempotent (same request id) or a compare-and-set, so overlapping
runs cannot move money twice. Each item is handled and logged on its own. In order:

1. **Holds past their 48 hours** expire; a confirmed authorization is voided.
2. **Revokes that stopped half-way**: open holds are declined by `system` and voided; the PayPal
   token is deleted, and a refused deletion is tried again on the next run (D29).
3. **Orders** (INITIATED, UNKNOWN, PENDING, untouched for 2 minutes so a running checkout is left
   alone). Known to PayPal by id: read it. Otherwise, within 30 minutes of the decision, send it
   again with its request id — but not once the hold has closed or the mandate was revoked, since
   that could start a payment nobody wants any more. Later, search PayPal's records once they have
   caught up (3 hours); "not found" fails the payment only a day after the decision, and an
   unanswered search never does (it is logged as an error).
4. **Captures and voids** of a hold (CAPTURING, VOIDING): within 30 minutes, send again with the
   request id; later, read the authorization. A capture approved before a revoke still completes.
5. **Authorizations confirmed after their hold closed** are voided — last, so one a lookup has
   just confirmed is released in the same run.

Payments that must wait are paged by cursor, so a backlog never hides the payments behind it;
lists an item leaves once handled are drained until a page has nothing new.

## D35 · 2026-10-12 · Mandate setup: one request to PayPal however it is finished

- `startMandate` creates a PENDING mandate with the owner's limits (validated; unknown fields are
  refused, not ignored) and asks PayPal for a setup link. If PayPal cannot start it, the new
  mandate is revoked at once, so there is never a PENDING mandate without a setup to finish.
- The owner's return from PayPal and the resolver's poll both ask PayPal for the saved method with
  the same PayPal-Request-Id, derived from the mandate id, so PayPal sees one request.
- `pending` (approved, vault id not issued yet) is left for a webhook or the next poll. Setups are
  polled from 5 minutes old, by cursor; one PayPal still has nothing approved for after 3 days is
  given up (revoked). PayPal is asked once more before giving up, so a late approval is kept.
- A method PayPal saves after the owner revoked is deleted at PayPal and never stored.

## D36 · 2026-10-12 · Revoking is ordered so that a crash never leaves money able to move

`revokeMandate` revokes the mandate first: from that write on, the store refuses every charge and
every approval (D25, D26). Only then are open holds declined (by the owner) and voided, and the
saved method deleted at PayPal. A crash after the first step leaves work the resolver finishes
(D28, D29, D34); it never leaves a window in which money could still move. Revoking again is a
no-op that retries whatever is left.

Agent keys are per agent: revoking one stops that agent at once and touches nothing else. A key is
shown once when issued; lists show only its prefix, and no key is ever logged. A revoked mandate
gets no new agents; limits change only as a new policy version, refused after a revoke.

## D37 · 2026-10-12 · Webhooks are stored once, applied like any other report, and never stuck

- A delivery is verified with PayPal first. A forged or unreadable one is rejected (400); one
  PayPal could not verify in time asks for a retry (503). A verified event is stored once by its
  id; a redelivery of a processed event is acknowledged and does nothing.
- Payment events go through the same state machines as call results: a late or repeated event is
  stale and changes nothing, one that needs a PayPal id Slip does not have yet waits for the
  lookup, and one that cannot fit is logged as a contradiction. An event naming a payment Slip
  never made is acknowledged and logged — `custom_id` is outside data until it matches.
- An authorization confirmed after its hold closed is voided at once.
- A saved method created for a setup activates its mandate. A saved method deleted at PayPal by
  the owner is a revoke: Slip stops, releases open holds, and records the deletion.
- An event Slip refuses on purpose (a conflict, an impossible move) is logged for a human and
  marked processed, so it cannot block the events behind it. A failure that may pass (the database
  dropped the connection) leaves it unprocessed; PayPal redelivers, and the resolver re-runs it
  first, before it asks PayPal about anything, once it is two minutes old.

## D38 · 2026-10-16 · Workspace sources are exported under a private `@slip/source` condition

Packages exported their TypeScript sources under `development`. Next.js's bundler resolves that
condition in `next dev` but cannot follow the sources' `./x.js` imports to `./x.ts`
(vercel/next.js#82945), so the web app could not import any workspace package. The sources now
sit under `@slip/source`, which only our own tools ask for: Vitest (`vitest.shared.ts`), the
type-check of tests (`customConditions` in each `tsconfig.test.json`) and `tsx` (the migrate
script). Next.js and anything else gets the built `dist`, so the web app runs `tsc -b` first (and
`tsc -b -w` beside `next dev`).

## D39 · 2026-10-16 · One receipt renderer, in its own package

The plain-language receipt moved from `@slip/app` to `@slip/receipt`, a pure package that depends
only on the domain. The application (checkout, holds, the agent's reads), the MCP server and the
owner UI all render receipts through it, so the words an agent receives and the words the owner
reads can never drift apart. `@slip/app` re-exports it unchanged.

## D40 · 2026-10-16 · Percentages: one decimal below 10 %, whole above, never under a limit

Gaps are computed from exact cents and rounded half-up: one decimal below 10 %, a whole number
from 10 % up, a trailing ".0" dropped — "$11.00 over $47.99" reads "23%", not "22.9%", which is
easier to take in at a glance and no less honest. When the receipt says a gap was above the
owner's limit, the printed figure is never at or below that limit: decimals are added until it
is strictly above ("5.001%", not "5%" next to "more than 5%"). The report card's medians follow
the same rule. The owner's own limits and a store's commission rate are not computed, so they
print exactly as set.

## D41 · 2026-10-16 · The theme is a token contract, checked by tests

The owner UI ("Till Roll") has two themes, Original and Carbon, defined once as `--slip-*` custom
properties in `@slip/ui/tokens.css`. Every other stylesheet uses only those variables: a design-lint
test rejects colour literals, gradients (except one fenced perforation mask), blurred shadows,
radii above 4px and any font but IBM Plex Sans and Mono. A second test checks every text colour
against the paper and the desk in both themes (WCAG AA, 4.5:1; 3:1 for rules). It caught the
approved palette's ghost ink at 2.88:1 on the desk in Original, so that ink is now `#898376`.

The server renders `data-slip-theme` from the owner's saved cookie, and without one the stylesheet
follows the system's colour scheme, so the first paint is right and no script runs before it.

## D42 · 2026-10-16 · The web app's server holds one copy of each workspace package

The application tells refusals apart with `instanceof` on domain errors (`HoldAlreadyDecidedError`,
`ConflictError`, …). If the web server loaded `@slip/app` with one copy of `@slip/domain` and
`@slip/db` with another, every typed refusal on approve, decline or revoke would become a server
error. The spike behind the web shell measured what Next.js 16 (Turbopack) does: it bundles
workspace packages — their real paths are outside node_modules, so `serverExternalPackages` does
not apply to them — into one server graph that every route shares, and keeps real node_modules
packages such as PGlite external. One graph means one copy: a duplicate email through
`registerOwner` came back as the typed `EMAIL_IN_USE` refusal under `next start`. The config still
lists the server packages together, so a bundler that honours the list keeps them together too.
The web server code reads result unions only and never does its own `instanceof` on domain errors.

## D43 · 2026-10-16 · The owner is identified by a signed cookie, not by a URL

Every owner query is scoped by the owner id (`packages/app/src/owner/queries.ts`), so the id has to
come from something the browser cannot edit. A session cookie carries the owner id, the mandate
being read and an expiry, signed with HMAC-SHA256 under a key derived for that one purpose
(`owner-session-v1`), so the signature cannot be confused with the key that protects vault ids.
Nothing in it is secret — those ids are in the URLs too — so it is signed rather than encrypted.

The payload is fixed fields in a fixed order (`v1.<owner>.<mandate>.<exp>`, UUIDs and digits, none
of which can contain the separator), which leaves no room for a canonicalisation trick, and the
signature is compared in constant time. The cookie is HttpOnly and `SameSite=Lax`, so the owner
returns from PayPal still signed in, and in production it carries the `__Host-` prefix, which the
browser accepts only over HTTPS from the root path. An expired cookie is refused however well it is
signed. A demo without `SLIP_ENCRYPTION_KEY` signs with a per-process key: its sessions end with
the process, and anywhere else a missing key stops the server from starting.

## D44 · 2026-10-16 · Live updates compare a change stamp, not an event log

The owner's pages must show a receipt the moment an agent's purchase is decided, without polling
every list on every tick. `Store.live.stamp(mandateId)` answers with counters for one mandate:
attempts, payment events, PayPal ids recorded, decided holds, the policy version, the mandate's
step and vault deletion, agents created and revoked. The pages ask for it about once a second and
re-read only what they show when a number has moved.

Every counter only grows, because the database already guarantees it: attempts, payment events and
policy versions are append-only, a hold is decided once, PayPal ids are set once, and a mandate's
status moves one way. So two readings can be compared without knowing what changed, and nothing
can be missed — which a "latest id" would risk, since two writes can commit out of order and the
newer id may appear first. PayPal ids are counted because a move that only fills in an id writes
no event, and the owner should still see it.

It needs no migration: one statement with a counting subquery per table, each over an indexed
column. The alternative, an append-only activity log read with an xmin horizon, stays the path for
scale and is not needed at one mandate per owner.

## D45 · 2026-10-17 · Typed errors are recognised across bundled copies (amends D42)

D42 is wrong about one thing: Next.js puts pages and route handlers in separate server graphs, and
each graph carries its own copy of the workspace packages (`SlipError` appears in both the route
chunk and the page chunk of a build). The runtime they share hangs off `globalThis`, so its store
throws the error classes of whichever graph built it first, and the other graph's `instanceof`
missed them: a second tab approving a decided hold could see "Checking with PayPal…" instead of
"Already approved", and a checkout race could surface as a server error.

Every Slip error class now declares its own `kind` (an explicit string, because a minifier may
rename classes); each error records the kinds of its class chain under the `Symbol.for`
key `slip.error.kinds`, shared by every copy; and `SlipError`'s `Symbol.hasInstance` checks that
record. `instanceof` therefore means "is this kind of Slip error", whichever copy made it. A class
that forgets its own `kind` falls back to the ordinary prototype check rather than answering for
its parent, and a test loads the module twice and checks every class both ways.

## D46 · 2026-10-17 · The demo's stand-ins are kept per visitor

A demo process serves every visitor from one fake PayPal and one fake catalogue. The fake PayPal
keeps a single queue of scripted outcomes, and the fake catalogue goes down for everyone at once,
so one visitor's "make the next payment time out" or "Channel3 is down" reached whoever paid
next; the seed itself flipped the global outage around an `await`, so two visitors signing in
together could get each other's holds.

The web runtime wraps both. `DemoPayPal` holds forced outcomes per mandate and hands one to the
fake in the same synchronous step as that mandate's own call (the fake reads its queue before its
first `await`), drops any the purchase did not use, maps every order, capture and void to its
mandate for a per-visitor call log, and points approval links at Slip's own simulated approval
page. `DemoOffers` takes an outage per product, and every visitor's products carry ids of their
own (`trail-shoe--<mandate>`), so prices and outages never cross desks. Desks are never freed, so
sign-ins are capped per process and per address.

## D47 · 2026-10-17 · A demo paces its PayPal calls and runs its own resolver

The stand-in PayPal answered instantly, so the states Slip writes before each call — INITIATED,
CAPTURING, VOIDING — were never on screen: the page polls about once a second and shares each
change stamp for 900 ms. In demo mode every order, capture and void now takes 2 s
(`SLIP_DEMO_LATENCY_MS`), PayPal's deadline is 4 s instead of 15 so a forced timeout settles in
seconds, and the resolver leaves a payment alone for 5 s, longer than that deadline, so it never
re-sends a call still in flight.

A demo has no scheduler, so the runtime runs `runResolver` itself, 5 s after each run ends (never
two at once). It starts inside the shared runtime rather than in `instrumentation.ts`, which would
be one more server bundle with its own copies of the packages; the runtime is built once per
process whichever bundle asks first.

## D48 · 2026-10-17 · Money commands are never optimistic

The kit's command hooks (approve, decline, the kill switch, limits, keys) change nothing on the
page until the server answers: no receipt is drawn as paid, held or released on a guess. A hold's
preview is an explicit command, never a query, because a preview for a hold with nothing reserved
prices the item again (a Channel3 call, perhaps the classifier). A decision is sent at most once
at a time however often it is clicked. A call whose answer is lost is `unknown` — "Slip is
checking" — and the hook reads the receipt again every second, for up to 30 s, until the outcome
shows; it is never sent a second time on its own, because the first may have moved the money. An
issued agent key lives only in the hook's state, never in the query cache, a URL or a log.

## D49 · 2026-10-17 · The page refreshes what a moved counter affects, and nothing else

The kit's `useLive` reads the change stamp (D44) about once a second, compares its counters by
name, and invalidates exactly the queries each moved counter can affect: a new attempt refreshes
the roll, the tray, the mandate summary and the report cards; a payment event or a new PayPal id
refreshes receipts and the tray; a new limits version refreshes the limits and the summary. It
never writes into the cache, so the page always shows what the server returned. Changes are
batched (250 ms after the last, 1 s at most) and invalidated without cancelling reads already
under way, so a burst cannot starve a multi-page refetch. The last token is recorded before the
refresh; the server reads the stamp before a page's data and hands it over as the starting token,
so a change in between is caught on the first look. Polling rests while the tab is hidden, stops
when signed out, and reports "offline" until Slip answers again.

## D50 · 2026-10-17 · Live updates stay on the stamp poll; no server-sent events for now

The UI plan put server-sent events on top of the stamp poll. They are not built: the poll (D49)
already prints a new receipt within about a second; each owner has one mandate, so a reading is
one cheap counting statement; and the demo runs as one long-lived process. Events would add held
connections, a planned close and reconnect every minute where serverless functions are capped,
and EventSource's own rules (a non-200 closes it for good, a planned close fires `error`), all to
save under a second. The client's unused `liveUrl` is removed rather than left pointing at a
route that does not exist. If many owners or tighter latency need it, events can carry the same
stamp, and `useLive` would refresh exactly as it does now.

## D51 · 2026-10-18 · The MCP server is a package, served by the web app at /api/mcp

Slip's MCP tools live in `@slip/mcp`, which has no web framework in it: `createSlipServer` builds
the server for one agent, and `createSlipMcpEndpoint` serves it as a web-standard
`(request) => response`. The web app mounts that endpoint at `/api/mcp`. It runs in the web
process because the demo's state lives there: the memory store, the stand-in PayPal's vaults and
each desk's products. With Postgres and the real adapters the same route works on any instance.
The package keeps the tools testable on both stores in `tests/`, lets a platform mount them in its
own app, and lets the benchmark serve them in-process. There is no stdio entry: it would need the
database and PayPal's credentials on the agent's machine. SPEC §8 already placed the server in
`packages/mcp`.

## D52 · 2026-10-18 · The MCP wire is snake_case; the key is the agent; refusals are tool errors

Arguments and answers are snake_case, as SPEC §8 writes them. The REST endpoint keeps its
camelCase and full `ReceiptView`. SPEC §8's `agent_id` arguments are dropped: the key identifies
the agent (extending D31), so `get_report` takes nothing, and `get_receipt` reads only the
caller's own receipts.
- **Answers.** `checkout` and `get_receipt` return one object: the decision, the payment, the two
  offers and the gap, the owner's receipt lines word for word (D39), and a `next_step`. The SDK
  requires an object at the top level, so there is no union.
- **`next_step`** is MCP guidance that names the tools. It lives in `@slip/mcp`, not
  `@slip/receipt`, and never restates money facts, so it cannot contradict the receipt.
- **Refusals** (`MANDATE_NOT_ACTIVE`, `BUSY`, `RETRY_LIMIT`, …) are tool errors (`isError`) whose
  text a model can act on.
- **Failures inside Slip** are logged and answered with a fixed sentence. The SDK would otherwise
  pass the exception's own message to the agent.

## D53 · 2026-10-18 · One stateless handler for both protocol eras, the key checked per request

The endpoint serves 2025-era clients (Claude Code today) through the SDK's stateless fallback and
2026-07-28 clients per request; nothing is kept between requests. On every request it:
1. refuses a browser `Origin` from another site (403);
2. reads the Bearer key, so a revoked key fails on its next call (401);
3. caps the body at 64 KiB;
4. hands the SDK the agent and its permission.

The server advertises no changing tool list, so no client holds a subscription stream open. Slip
parses the header itself because the SDK's bearer helper requires an expiry and Slip's keys don't
expire. The key is never logged.

## D54 · 2026-10-18 · Search is a hook the host supplies; the classifier's search context stays empty

`search_products` exists only when the host gives the server a `ProductSearch`. It is not part of
the check: every checkout is priced from Slip's own snapshot whatever a search showed. Channel3's
search costs credits, unlike fetching a product, and its adapter doesn't exist yet, so it is not a
port method.
- **Demo.** Searches only the desk's own copies of its products. Listing text, including the
  synthetic labels, passes through verbatim and is labelled as the store's untrusted words.
- **Classifier.** `searchContext`, meant to carry what Slip's search showed the agent, stays
  `null` until searches are recorded. Recording them belongs with the Channel3 adapter.

## D60 · 2026-10-18 · A listing's text comes only from the offer itself

Channel3 gives a product one shared `description` and each merchant's offer its own `title` and
`description`. The steering check reads **only the offer's own text**. The shared description is
identical across every merchant, so a prompt injection hidden in it would flag whichever offer the
agent happened to pick — Slip would hold a purchase and blame a merchant that wrote nothing.

An offer with no text of its own gets `listingText: null`, and the check is simply not run for it
(`checkOffers` already skips a listing with no text). An unflagged offer is the right answer there:
Slip has seen nothing to object to.

## D61 · 2026-10-18 · A failure detail is Slip's own words, never the service's text

Every adapter maps a failure to its port's reason plus a short `detail`. That detail is built from
the status and a fixed sentence Slip wrote; the service's own message body is dropped.

Two reasons, either sufficient. A 401 from Channel3 answers `{"detail": "Invalid API key: <key>"}`
— the key itself — and these details are bound for a log. And a third party's free text is not
Slip's voice: nothing stops it from carrying a sentence addressed to whoever reads it, which is the
same injection surface the steering check exists for. The status is the diagnostic part and is
always kept (`Channel3 answered 402: there are no catalogue credits left`). Our own transport
errors are different — `TypeError: fetch failed (ENOTFOUND)` is Slip's own text, and it stays.
