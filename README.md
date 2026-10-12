# Slip

**The second opinion on every agent purchase.**

AI agents are starting to spend people's money, and nothing checks whether they are overpaying
or being steered. Slip checks every purchase an agent attempts before PayPal moves the money. It
compares the chosen offer with the other listed offers for the same item (from Channel3), flags
steering and cases where the pricier store pays more commission, and applies the owner's limits:
pay, reject, or hold for a human.

> Agents shop. Slip checks. Policy decides. PayPal pays.

The demo runs in PayPal sandbox with Slip as the seller. Prices, offers and commission rates are
real (Channel3); no order reaches a retailer; no real money moves. Read
[docs/SPEC.md](docs/SPEC.md) for the full spec and [docs/diagram.png](docs/diagram.png) for the
execution flow. Design decisions are logged in [docs/DECISIONS.md](docs/DECISIONS.md).

## Layout

```
packages/domain    types, money (integer cents), state machines, ports (store, offers,
                   payments, classifier, clock), shared invariants — no I/O       (done)
packages/check     the pure check: freshness → variant → locate → comparable → gap → rules (done)
packages/db        Postgres store (Drizzle on postgres.js or PGlite), in-memory fake,
                   migrations with database-level guards                         (done)
packages/app       use cases: checkout, holds, resolver, webhooks, mandates,
                   agent keys, receipts and report card                           (done)
packages/offers    in-memory Channel3 fake (done); Channel3 adapter     (needs Channel3 key)
packages/paypal    in-memory PayPal fake (done); REST adapter          (needs PayPal sandbox)
packages/steering  scripted classifier fake (done); Claude classifier  (needs Anthropic key)
tests              end-to-end scenarios on the fakes and PGlite, and a reusable testkit (done)
apps/web           owner UI: mandate, receipts, holds, limits, report           (next)
apps/mcp           MCP server: search, checkout, get_receipt, get_report
study/  bench/     market study and SlipBench
```

Dependencies point inward: apps → app → check / domain. Adapters implement ports declared in
`@slip/domain`; every adapter ships a fake the tests and the benchmark replay use.

## Run

```sh
pnpm install
pnpm test          # type-checks everything (tests included), then runs every test project
pnpm lint          # biome
```

`pnpm test` needs nothing else: the database and end-to-end tests run on PGlite, an in-process
Postgres, against fake Channel3, PayPal and classifier, on a manual clock.

Real Postgres (Docker):

```sh
pnpm db:up         # Postgres 18 on localhost:54329 (docker compose)
pnpm test:pg       # same store contract + database guards + concurrency races on real Postgres
DATABASE_URL=postgres://slip:slip@localhost:54329/slip pnpm db:migrate
```

No Docker: `DATABASE_URL=pglite://.data/slip pnpm db:migrate` gives a Postgres on disk.

Schema changes: edit `packages/db/src/schema.ts`, run `pnpm db:generate`, commit the new SQL in
`packages/db/drizzle/`. Triggers and lookup tables live in hand-written migrations.

Requires Node ≥ 22.12 and pnpm 10 (`corepack enable` picks the pinned version).

## Status

Done: the check, the domain model, persistence, and every use case, running on fakes of the
three outside services.

- **Checkout** — key, ACTIVE mandate and request checked; one checkout per agent and product at a
  time; repeats replayed rather than paid twice; prices refreshed from Channel3 within their
  freshness window; the steering classifier asked only when the check needs it. The decision and
  its payment are written before PayPal is called, and a PayPal timeout is "unknown", never
  "failed".
- **Holds** — the owner previews what approving costs and approves that amount: a reservation is
  captured in full, once; a hold with nothing reserved is checked again on current prices and paid
  in one step only at the price shown. Declining releases the reservation.
- **Resolver** — expires holds, finishes half-done revokes, re-sends orders, captures and voids
  with their original request ids within 30 minutes, then looks them up; releases authorizations
  that arrive after their hold closed; polls mandate setups; re-runs webhooks that failed.
- **Webhooks** — verified, stored once, and applied through the same state machines, so late,
  repeated and out-of-order deliveries converge.
- **Mandates and agents** — setup at PayPal, the kill switch, limit changes as new policy
  versions, API keys shown once and stored hashed, and agent-scoped receipts and report card.

Every write that can move money is atomic, fenced by the checkout lease, refused once the mandate
is revoked, and guarded twice: by shared pure rules in code and by constraints and triggers in
Postgres. The spec's §11 scenarios and the money paths run end to end on both stores.

Next: the owner UI on top of `@slip/app`, then the MCP server; the Channel3, PayPal and Claude
adapters replace the fakes once API keys are available. See `docs/SPEC.md` §15 for dates and
`docs/DECISIONS.md` (D1–D37) for every departure from the written spec.
