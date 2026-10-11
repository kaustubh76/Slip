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
packages/domain    types, money (integer cents), policy, payment state machine — no I/O
packages/check     the pure check: freshness → variant → locate → comparable → gap → rules
packages/offers    Channel3 client + snapshot cache                       (increment 1)
packages/db        Drizzle schema, migrations, repositories               (increment 2)
packages/paypal    PayPal REST adapter: orders, holds, vault, webhooks    (increment 3)
packages/app       use cases: runCheckout, holds, resolver, reconcile     (increment 4)
packages/steering  schema-locked steering classifier                     (increment 5)
apps/mcp           MCP server: search, checkout, get_receipt, get_report (increment 6)
apps/web           owner UI: mandate, receipts, holds, limits, report    (increment 7)
study/  bench/     market study and SlipBench                            (increments 1, 8)
```

Dependencies point inward: apps → app → check/domain. Adapters implement ports declared in
`app`; every adapter ships a fake used by tests and by the benchmark replay.

## Run

```sh
pnpm install
pnpm test        # builds every package, then runs all test projects
pnpm lint        # biome
```

Requires Node ≥ 22.12 and pnpm 10 (`corepack enable` picks the pinned version).

## Status

Increment 0 is done: the monorepo foundation, `@slip/domain` and `@slip/check`, with the spec's
regression scenarios, boundary cases and property tests green (`pnpm test`). Nothing talks to a
network yet. Next, in order: persistence (`db`), orchestration with fake adapters (`app`), the
MCP server, the owner UI; then, once API keys are available, the Channel3 and PayPal adapters,
the steering classifier and SlipBench. See `docs/SPEC.md` §15 for dates and `docs/DECISIONS.md`
for what changed from the written spec.
