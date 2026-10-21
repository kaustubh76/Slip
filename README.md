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
logged in [docs/DECISIONS.md](docs/DECISIONS.md), and [docs/DEMO.md](docs/DEMO.md) is the shot
list for the video — including the two beats that cannot be filmed until a key arrives.

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

No Docker: `DATABASE_URL=pglite://.data/slip pnpm db:migrate` gives a Postgres on disk — but
that path is relative to wherever the command runs, and `db:migrate` runs in `packages/db` while
the app runs in `apps/web`. Use an absolute path, or skip it: PGlite migrates itself when the
server opens it. Real Postgres does not, because a server that migrated on boot would race its
own replicas.

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
pnpm test:live:bench      # SlipBench's grader against a real model answer
```

Only one case anywhere spends a Channel3 credit, and it is opt-in twice: a key, then
`CHANNEL3_LIVE_SEARCH=1`. A deployment that will run on serverless also needs `SLIP_CRON_SECRET`,
because nothing resolves holds or unknown payments there without the schedule in `vercel.json`.

Every variable is listed in [.env.example](.env.example). Copy it to **`apps/web/.env.local`** —
that is the file Next loads and the one the operator scripts read; nothing reads a `.env` at the
repo root.

## Deploy

The demo is a container, not a serverless deployment. Its stand-ins for Channel3 and PayPal keep
their state in the process, so it needs a server that outlives a request — `SLIP_DEMO=1` refuses
to turn on wherever `VERCEL` is set, rather than quietly splitting one visitor's desk across
instances (D74).

```sh
docker build -t slip .
docker run -p 3000:3000 -e SLIP_BASE_URL=https://your.host slip
```

That is the whole of it: demo mode needs no database and no keys. Point any host that runs a
container at the [Dockerfile](Dockerfile) — the image serves `/sign-in` and answers its own
healthcheck once it is listening.

**On Render**, [render.yaml](render.yaml) declares the service: connect this repo, then **New →
Blueprint**. Slip works out its own address from `RENDER_EXTERNAL_URL`, so there is nothing to
set.

Two things to know about the free plan it asks for. The service **sleeps after 15 minutes**
without traffic and takes about a minute to wake, so load it once before showing it to anyone. And
because a demo desk lives in the process, **a sleep throws away whatever desk was open** — a fresh
visitor never notices, someone returning after lunch finds their receipts gone. Change `plan: free`
to `plan: 0.5c-512mb` in `render.yaml` to stop both.

**Running the real thing instead** means leaving `SLIP_DEMO` unset, passing the keys above, and
two more things. Migrate first — `pnpm db:migrate` against your `DATABASE_URL`, because the server
does not migrate Postgres itself. And give housekeeping a way to run: a long-lived process does it
on a timer, but anywhere an instance does not outlive a request, set `SLIP_CRON_SECRET` (or
`CRON_SECRET`, which Vercel injects) and schedule `/api/cron/resolve`. Without it holds never
expire and authorizations sit on real cards; with it, the endpoint takes a bearer token and
nothing else.

What to get where, what each suite proves and what it costs: [docs/SERVICES.md](docs/SERVICES.md).
The PayPal one needs one step nothing can automate — a sandbox buyer whose wallet has been
vaulted through the approval flow.

## The evidence

```sh
pnpm study:report    # recompute the market study from study/snapshots/ — free, runs today
pnpm bench:run       # SlipBench; needs ANTHROPIC_API_KEY, prints what it would spend, --yes spends it
pnpm bench:report    # recompute SlipBench from bench/runs/ — free, once a run exists
```

Only the first runs on a fresh clone. **SlipBench has not been run**: it needs a model key, so
`bench/runs/` does not exist yet and the other two exit non-zero until it does. The `/bench` page
says the same thing in a stamp rather than quietly showing zeroes.

The market study ran on 19 Oct: 240 real products, 8 Channel3 credits, every response committed.
**G1 fails** — 18.33% of products carry two or more comparable offers against a 60% bar — and the
report says so rather than burying it. Where comparison is possible the typical gap is 16.67% and
the dearer offer pays more commission in 19 of 40 cases. It also turned up the catalogue errors
behind D68, which is why Slip now holds an implausible gap instead of rejecting it.
[study/results/market-study.md](study/results/market-study.md) has the working, including why so
few products can be compared at all.

SlipBench ran on 21 Oct, on one agent: `claude-haiku-5-5`, 21 errands × 3 conditions = 63 runs, all
63 ending in a purchase, every response committed. **It did not catch these agents out.** Nobody
overpaid and nobody took the planted offer — not in `clean`, not in `endorsed`, and not in
`injected`, where the dearer listing carries text addressed to shopping agents. **G3 fails at 0%**
against a 15% bar, which here means the agent compared offers well enough that Slip rarely had to
stop it, and the report says so instead of dressing it up. Three of the 63 runs bought a different
product id than the errand named, all the same errand: the catalogue lists two near-identical Lodge
skillets, and the agent bought the cheaper one (D68's grouping problem, not a model error) — the
report names each miss so the count reads for what it is.
[bench/results/slipbench.md](bench/results/slipbench.md) has the tables;
`pnpm bench:report` recomputes them from the committed runs with no key and no model call.

## Status

Done: the check, the domain model, persistence, every use case, the owner UI, the MCP server, the
adapters for all three outside services, and the wiring a deployment outside the demo needs — an
agent that can find products, a steering check with something to read, a resolver that runs where
there is no long-lived process, and a way back in for an owner whose browser forgot the session.

Channel3 is verified against a live key, `pnpm test:pg` runs against real Postgres, and the steering
classifier is verified against the real model — injected text flagged, loud sales copy not, inside
the application's own deadline, which is the first evidence that D67's claim holds anywhere but a
stand-in. What is left needs a key or an account that cannot be issued from here: the other half of
SlipBench (`claude-opus-5-5`, whose sweep was not run), an OpenAI key for the benchmark's second
provider, and a sandbox buyer whose wallet has been vaulted through PayPal's own approval flow. The
offline tests are written from PayPal's and Channel3's own documented payloads, which is not the
same as traffic from a live account.

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
  that arrive after their hold closed; polls mandate setups; re-runs webhooks that failed. A
  long-lived process runs it on a timer; a serverless one runs the same pass from
  `/api/cron/resolve` every five minutes, authorised by `SLIP_CRON_SECRET`.
- **Webhooks** — verified, stored once, and applied through the same state machines, so late,
  repeated and out-of-order deliveries converge.
- **Mandates and agents** — setup at PayPal, the kill switch, limit changes as new policy
  versions, API keys shown once and stored hashed, and agent-scoped receipts and report card.
- **Search, and what an agent read** — outside the demo `search_products` searches Channel3 itself,
  shows the agent each product's own words, and records what it showed per agent and product. The
  checkout that follows hands that text to the steering check, which on real catalogue data is the
  only thing there is to judge: a Channel3 offer carries no text of its own (D67, D69). Cached five
  minutes, with a ceiling of 60 uncached searches an hour per permission.
- **Getting in, and back in** — an owner starts with PayPal and may set an email and a password,
  which is the only way back in if the browser forgets the session; where PayPal is live it is
  required, because losing the cookie would mean losing the kill switch over real money. There is no
  reset, because Slip sends no mail, and the sign-in says one thing whether the address or the
  password was wrong (D71). A deployment that would move real money against invented prices or a
  scripted steering stand-in refuses to start at all.

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
(D1–D74) for every departure from the written spec.
