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
packages/domain    types, money (integer cents), state machines, the Store port,
                   shared invariants — no I/O                                    (done)
packages/check     the pure check: freshness → variant → locate → comparable → gap → rules (done)
packages/db        Postgres store (Drizzle on postgres.js or PGlite), in-memory fake,
                   migrations with database-level guards                         (done)
packages/app       use cases: runCheckout, holds, resolver, reconcile     (next)
apps/mcp           MCP server: search, checkout, get_receipt, get_report
apps/web           owner UI: mandate, receipts, holds, limits, report
packages/offers    Channel3 client + snapshot cache                       (needs Channel3 key)
packages/paypal    PayPal REST adapter: orders, holds, vault, webhooks    (needs PayPal sandbox)
packages/steering  schema-locked steering classifier                     (needs Anthropic key)
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

`pnpm test` needs nothing else: the database tests run on PGlite, an in-process Postgres.

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

Done: the check, the domain model and persistence. Every write that can move money — the
decision, the write-ahead payment, hold decisions — is atomic, fenced by the checkout lease,
refused once the mandate is revoked, and guarded twice: by shared pure rules in code and by
constraints and triggers in Postgres. The in-memory fake passes the same contract as Postgres.

Next: orchestration (`app`) on the fakes, then the MCP server and the owner UI; the Channel3,
PayPal and classifier adapters follow once API keys are available. See `docs/SPEC.md` §15 for
dates and `docs/DECISIONS.md` for every departure from the written spec.
