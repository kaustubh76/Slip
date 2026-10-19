# Slip

**The second opinion on every agent purchase.**

AI agents are starting to spend people's money, and nothing checks whether they are overpaying
or being steered. Slip checks every purchase an agent attempts before PayPal moves the money. It
compares the chosen offer with the other listed offers for the same item (from Channel3), flags
steering and cases where the pricier store pays more commission, and applies the owner's limits:
pay, reject, or hold for a human.

> Agents shop. Slip checks. Policy decides. PayPal pays.

All three outside services — Channel3, PayPal and the steering classifier — have real adapters.
Each is used when its own keys are set and a stand-in otherwise, and the line under the tabs says
which: real Channel3 prices with a stand-in PayPal is a state Slip will actually be in, and a
receipt must not call either one the other ([docs/SERVICES.md](docs/SERVICES.md)). With the PayPal
keys it runs in the sandbox with Slip as the seller; no order reaches a retailer and no real money
moves. Read [docs/SPEC.md](docs/SPEC.md) for the full spec,
[docs/diagram.png](docs/diagram.png) for the execution flow and [docs/UI.md](docs/UI.md) for the
owner UI. Agents connect through Slip's MCP server: [TOOLS.md](TOOLS.md). Design decisions are
logged in [docs/DECISIONS.md](docs/DECISIONS.md).

## Layout

```
packages/domain    types, money (integer cents), state machines, ports (store, offers,
                   payments, classifier, clock), shared invariants — no I/O       (done)
packages/check     the pure check: freshness → variant → locate → comparable → gap → rules (done)
packages/db        Postgres store (Drizzle on postgres.js or PGlite), in-memory fake,
                   migrations with database-level guards                         (done)
packages/app       use cases: checkout, holds, resolver, webhooks, mandates,
                   agent keys, receipts and report card                           (done)
packages/http      the one JSON client: injected fetch, no retries, three outcomes   (done)
packages/offers    Channel3 adapter + in-memory fake          (done; live check needs a key)
packages/paypal    PayPal REST adapter + in-memory fake       (done; live check needs keys)
packages/steering  Claude classifier + scripted fake          (done; live check needs a key)
packages/receipt   the one receipt renderer: copy, state line, gap scale, wire schemas (done)
packages/ui        React kit: Till Roll theme, stationery components, client and hooks (done)
packages/mcp       MCP server: checkout, get_receipt, get_report, search_products,
                   and its HTTP endpoint                                           (done)
tests              end-to-end scenarios on the fakes and PGlite, and a reusable testkit (done)
apps/web           owner UI on Next.js: receipts, holds, limits, agents, permission slip,
                   kill switch, read API, agent endpoints (MCP and REST), demo mode (done)
study/             the market study: Channel3 sampler, the three numbers       (run 19 Oct)
bench/             SlipBench: errands, conditions, agents, replay       (built, needs a key)
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

## Run the demo

The owner UI runs without any API key, on stand-ins for Channel3 and PayPal in one process:

```sh
SLIP_DEMO=1 SLIP_BASE_URL=http://localhost:3000 pnpm web:dev
```

Open <http://localhost:3000>, choose **Open a demo desk**, and you get a fresh owner with a
permission in force and four purchases already checked: one paid, one rejected, two held. Then:

1. **Demo** tab → **Issue a key for the script**, and run the command it shows in a terminal:

   ```sh
   SLIP_AGENT_KEY=slip_live_… pnpm demo:agent --errand top-pick --url http://localhost:3000
   ```

   The script is an MCP client. It searches the desk's catalogue (the "[synthetic] Top pick"
   label marked as such), picks an offer, and calls `checkout`; the terminal prints Slip's
   receipt and next step. The REJECTED receipt prints on the open roll within a second.
   `--errand cheaper` pays: watch its status line go from INITIATED to CAPTURED. Without
   `--errand`, the script lists the errands.
2. **A real model.** The console also shows a `claude mcp add …` command with the same key. Add
   it in Claude Code, ask for a pair of trail shoes, and watch Slip decide on the roll.
3. **Holds** → approve or decline. The dialog names the exact amount, and the status line walks
   CAPTURING → CAPTURED or VOIDING → VOIDED.
4. The **Demo** console also makes PayPal time out, decline or leave a payment pending for one
   purchase, and raises a price so approving a hold meets PRICE_CHANGED.
5. **Mandate** → the kill switch. The agent's next call is refused.

Production build and browser tests (Playwright starts the built app in demo mode itself):

```sh
pnpm web:build
pnpm --filter @slip/web exec playwright install chromium   # once
pnpm web:e2e
```

Demo settings are listed in [docs/UI.md](docs/UI.md#demo-mode).

## Run the real services

`SLIP_DEMO=1` always uses the stand-ins — the demo gives every visitor their own catalogue, and
stands in for PayPal's approval page. Without it, each service is real as soon as its keys are set:

```sh
CHANNEL3_API_KEY=… \
PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… PAYPAL_WEBHOOK_ID=… PAYPAL_ENV=sandbox \
ANTHROPIC_API_KEY=… \
SLIP_ENCRYPTION_KEY=$(openssl rand -base64 32) \
SLIP_BASE_URL=http://localhost:3000 DATABASE_URL=pglite://.data/slip pnpm web:dev
```

Each adapter also has a live suite that skips itself until its keys exist:

```sh
pnpm test:live:channel3   # the key, the path, and offers the domain accepts
pnpm test:live:steering   # the prompt's boundary: injected text flagged, loud sales copy not
pnpm test:live:paypal     # the gateway contract the fake passes, against the sandbox
```

What to get where, what each suite proves and what it costs: [docs/SERVICES.md](docs/SERVICES.md).
The PayPal one needs one step nothing can automate — a sandbox buyer whose wallet has been
vaulted through the approval flow.

## The evidence

```sh
pnpm study:report    # recompute the market study from study/snapshots/ — free
pnpm bench:run       # what SlipBench would spend; add --yes to spend it
pnpm bench:report    # recompute SlipBench from bench/runs/ — free
```

The market study ran on 19 Oct: 240 real products, 8 Channel3 credits, every response committed.
**G1 fails** — 18.33% of products carry two or more comparable offers against a 60% bar — and the
report says so rather than burying it. Where comparison is possible the typical gap is 16.67% and
the dearer offer pays more commission in 19 of 40 cases. It also turned up the catalogue errors
behind D68, which is why Slip now holds an implausible gap instead of rejecting it.
[study/results/market-study.md](study/results/market-study.md) has the working, including why so
few products can be compared at all.

SlipBench is built and has not run: it needs an Anthropic key. 21 errands on real products, three
conditions (clean, endorsed, injected), with and without Slip, replayed from committed runs.
[docs/SERVICES.md](docs/SERVICES.md) says what it costs and what is still missing from it.

## Status

Done: the check, the domain model, persistence, every use case, the owner UI, the MCP server, and
the adapters for all three outside services. What is left is to run each live suite against a real
key — the offline tests are written from PayPal's and Channel3's own documented payloads, which is
not the same as traffic from a live account.

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

**Owner UI** — the Till Roll design in two themes (Original and Carbon): a roll of receipts that
prints new ones live, a tray of holds with countdowns, receipts that read in five seconds with
the offers behind them and a gap scale, approve and decline that name the exact amount and never
assume success, limits as numbered versions, agents with report cards and one-time keys, the
permission slip and its kill switch. The React kit (`@slip/ui`) holds the theme, the components,
a typed client and hooks, so a platform can embed it; the Next.js app hosts it with a read API, an
agent checkout endpoint and demo mode. Browser tests cover the money paths and run axe on every
page in both themes.

**MCP server** — agents pay through Slip's MCP tools at `/api/mcp`: `checkout`, `get_receipt`,
`get_report`, and `search_products` where a catalogue is available. Each wraps the same use case
as the REST endpoint, run with the agent's own key, and answers with the owner's receipt and a
next step. 2025-era and 2026-07-28 clients are both served; the key is checked on every request.
A real MCP client drives every tool path on both stores. See [TOOLS.md](TOOLS.md).

Next: the Channel3, PayPal and Claude adapters replace the fakes once API keys are available; then
the market study and SlipBench. See `docs/SPEC.md` §15 for dates and `docs/DECISIONS.md`
(D1–D54) for every departure from the written spec.
