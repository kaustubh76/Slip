# SLIP — Deploying it, and what each deployment can prove

**Prepared:** 30 October 2026 · **Companion to:** [SERVICES.md](SERVICES.md) (the three outside
services), [SPEC.md](SPEC.md) §19.6 (the credential hole)
**Status:** **deployed and live at <https://slip-two-chi.vercel.app>** (31 Oct 2026) on real
Channel3 prices, the real PayPal sandbox and the real steering check. The Render demo is still
**not connected** — §1 is one dashboard action. Nothing here sets `PAYPAL_ENV=live`.

Two deployments, because they cannot be one. Demo mode keeps its stand-ins for Channel3 and PayPal
in the process and gives every visitor a throwaway desk, so `isDemo()` refuses wherever `VERCEL` is
set rather than splitting one visitor's desk across instances (D74). So: **Render runs the demo,
and a serverless host runs the real thing.**

---

## 1 · Render — the demo, for showing the UI

`render.yaml` is a complete Blueprint. Connect this repo in Render, then **New → Blueprint**.
Nothing else is needed: demo mode uses the in-memory store, so there is no database to provision
and no key to set.

**Verified 30 Oct 2026:** `pnpm web:build` succeeds on **Node 22.16.0**, which is the major the
container pins (`node:22-slim`). Worth stating because the repo is developed on Node 26 — the build
is not assumed to be portable, it was run.

What it proves: every page, every state of the kit, the whole owner flow, and an agent buying
through the stand-in. What it cannot prove: anything about real money, real prices, or a real
steering check. Every page says which it is.

**The free plan sleeps** after 15 minutes without traffic and takes about a minute to wake — and
because a desk lives in the process, a sleep throws away whatever desk someone had open. For a
judged demo, `plan: 0.5c-512mb` in `render.yaml` avoids that.

---

## 2 · Vercel — the real services, for the money path

### 2.1 Done, and how the block was got round

**The MCP connector is read-only and that has not changed** — `PATCH /v9/projects` still answers
**403 forbidden**, as project creation did. What unblocked it was the third option below: the Vercel
CLI carries its own credentials, and `vercel api <path> --method PATCH` reaches every endpoint the
connector refuses. Worth knowing before anyone widens a connector's scope to solve this.

```
project          slip (prj_VB7qOXZz…), team kaustubh76s-projects
root directory   apps/web          node 22.x          framework nextjs
database         Neon slip-db, Free plan, iad1 — 16 tables, 9 migrations applied
webhook          re-pointed to the deployment, 8 events, id unchanged
```

**Two production domains, and only one of them is public.** Vercel Authentication is on for
`all_except_custom_domains`, so `slip-kaustubh76s-projects.vercel.app` answers **302** into
`vercel.com/sso-api` — and PayPal cannot deliver to that, nor can a judge open it. The short alias
`slip-two-chi.vercel.app` is **not** covered and serves publicly. `SLIP_BASE_URL` is the short one.
Check this with `curl` rather than assuming, because the protected domain fails in a way that looks
like a working site to anyone already signed in to Vercel.

**`DATABASE_URL` must be a real Postgres.** PGlite is a single-process file store, so on serverless
each instance would get its own copy and the app would be incoherent. `vercel integration add neon
--billing-plan free_v3` provisions one and connects it to all three environments without a
dashboard; the integration sets `DATABASE_URL` itself.

### 2.2 The settings, once it can be created

**Root Directory is `apps/web`.** That is how Vercel finds and builds a Next app in a pnpm
workspace, installing from the workspace root. `vercel.json` was moved to `apps/web/vercel.json` for
exactly this reason (`1bc9aae`): Vercel reads its configuration from the root directory, and left at
the repository root the `/api/cron/resolve` schedule would never have been registered — a silent
failure, since the app would deploy and serve while nothing expired a hold.

Environment variables, Production and Preview:

| variable | value |
|---|---|
| `DATABASE_URL` | a real Postgres connection string |
| `SLIP_ENCRYPTION_KEY` | 32 random bytes, base64 — the vault cipher's key |
| `CRON_SECRET` | a generated secret. **This exact name**: Vercel's scheduler sends a bearer token only for `CRON_SECRET`, and a deployment that set Slip's own `SLIP_CRON_SECRET` instead would answer 401 to its own cron for ever (D76) |
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID` | the sandbox app's three values |
| `PAYPAL_ENV` | `sandbox` |
| `CHANNEL3_API_KEY` | the Channel3 key |
| `SLIP_BASE_URL` | the deployment's own https address — see below |

Also set `ANTHROPIC_API_KEY`, which as of 30 Oct 2026 is accepted — see §5.

**Deliberately not set:** `SLIP_DEMO`, since demo mode is refused on Vercel anyway — and
**`SLIP_AGENT_SEARCH`**, which is what offers agents `search_products` (D106). A search costs a
Channel3 credit per call where the rest of a checkout costs nothing, and sign-up is open, so leaving
it unset is what stops an address that got out from spending the account's credits. Prices and
receipts are unaffected: re-pricing reads Channel3's free product-detail endpoint. With it unset the
MCP server does not register the tool at all, so an agent on this deployment has to be handed a
product id rather than looking one up. Set it to `1` for a judged run if the search-then-buy story
is wanted, and unset it afterwards.

The rule that key has to follow is worth keeping even now that it works. A *missing* key makes the
steering check the scripted stand-in, which every receipt then says plainly. A **rejected** key is
worse than none: `resolveServices` only checks that the variable is *present*, so Slip would report
a real classifier while holding every purchase whose price gap needed one, with a receipt that reads
exactly like a slow model (SPEC §19.6). Only `pnpm doctor:keys` tells the two apart — so it is the
pre-flight before a deployment, not only before going live.

**Migrate the database before anything serves.** This step was missing from this runbook until
31 Oct 2026, and it is the one omission that produces a deployment which builds, serves, and fails
every request:

```sh
DATABASE_URL=<the connection string> pnpm db:migrate
```

`openStore` in `apps/web/src/server/runtime.ts` migrates **PGlite only**, and deliberately: a
PGlite database is the process's own, while *"a web server that migrates on boot would race its own
replicas"*. So a Postgres deployment is never migrated by the app. A fresh database that nobody has
migrated has no tables, and every page and every endpoint fails against it — while the build is
green and the host reports a successful deploy.

**`SLIP_BASE_URL` is a two-step.** It is the only place Slip knows its own scheme and host, and
PayPal is handed it as the brand name on a checkout and uses it to build the approval's return URL
(D76). So: deploy, take the assigned address, set the variable, redeploy.

### 2.3 Then point the webhook at it

```sh
pnpm paypal:webhook https://<the deployment's host> --save
```

This creates the webhook the first time and re-points the same one afterwards, subscribing to
`SLIP_WEBHOOK_EVENTS` intersected with what the app is offered. It writes to PayPal whether or not
`--save` is given; `--save` controls only whether `PAYPAL_WEBHOOK_ID` is written into
`apps/web/.env.local`.

**Done, 31 Oct 2026.** The webhook had been subscribed correctly — 8 events, a clean match for
`SLIP_WEBHOOK_EVENTS`, its id the one in `.env.local` — and pointed at a Cloudflare quick tunnel
from an earlier session that no longer resolved. Everything about it was right except the only part
that mattered, and `GET /v1/notifications/webhooks-events` returning **0 events** was not
reassurance: it meant nothing had yet happened *to* deliver. It is now on the deployment's own
address, with the **same webhook id**, so `PAYPAL_WEBHOOK_ID` did not have to change anywhere.
`pnpm doctor:keys` confirms it:

```
Webhook            ok             PayPal would deliver to slip-two-chi.vercel.app, which is this deployment
```

On a serverless host the address is stable and this is a one-off; on a quick tunnel it is every run.

### 2.4 Housekeeping runs **once a day**, not every five minutes

`vercel.json` asked for `*/5 * * * *` and the deploy was **refused**:

> Hobby accounts are limited to daily cron jobs. This cron expression (\*/5 \* \* \* \*) would run
> more than once per day.

So the committed schedule is now `0 3 * * *`, which deploys. **That is a real loss and not a
slower version of the same thing.** `orderResendWindowMs` is **30 minutes**
(`packages/app/src/config.ts`), and the resolver's second branch re-sends an unknown order inside
that window with the same request id. A sweep that fires once a day misses the window outright for
all but a few minutes of the day, and the branch after it waits on `reportingLagMs` (3 h) and then
asks **Transaction Search** — which is the box nobody has ticked. So on a Hobby plan with the grant
off, an unknown payment has *no* working resolution path. Each piece is individually defensible and
together they close every door.

**The chosen fix is an external scheduler**, every five minutes, which needs no plan change. Any
pinger will do — `authoriseCron` accepts `CRON_SECRET` *or* `SLIP_CRON_SECRET` as a bearer:

| | |
|---|---|
| URL | `https://slip-two-chi.vercel.app/api/cron/resolve` |
| Method | `POST` |
| Header | `Authorization: Bearer <CRON_SECRET>` |
| Every | 5 minutes |

Read the value out of the gitignored local env rather than from here, and do not paste it into a
page or a URL — it is a bearer token:

```sh
grep '^CRON_SECRET=' apps/web/.env.local | cut -d= -f2-
```

It is stored on Vercel as a **config** variable and not a secret, precisely so it can be read back
for this. A sensitive variable cannot be, and an unrecoverable secret would force a rotation just to
get a pinger working — which is a mistake worth not repeating, because it was made here first.

The daily Vercel cron stays as a backstop. **The gate in §4 shuts when a sweep driven by the pinger
has been seen, not when the pinger is configured** — the endpoint answering by hand proves the door,
not the schedule. The alternative remains **Vercel Pro** plus a one-line revert of
`apps/web/vercel.json` to `*/5 * * * *`.

Verified on the deployment: unauthenticated `POST /api/cron/resolve` answers **401**, and with the
bearer it answers the resolver's own report across all nine task groups.

---

### 2.5 Is it actually wired? `pnpm verify:deployment`

```sh
pnpm verify:deployment                        # the production address
pnpm verify:deployment https://slip.example   # anywhere else
```

`doctor:keys` asks the outside services what they make of this deployment's credentials and grants.
It cannot tell you whether a **write** works, because it writes nothing — and after a deploy with
green credentials, a database with no tables would look exactly like a working site. So this starts
an owner, takes a real PayPal setup token, issues a real agent key and speaks MCP with it. Observed
on 31 Oct 2026:

```
  owner started       ok       PayPal took the browser to www.sandbox.paypal.com
  permission stored   ok       PENDING · 51cf82ae-acf2-4ba4-b2ca-3809a63f967b
  agent key issued    ok       shown once, and not printed here
  MCP handshake       ok       3 tools: checkout, get_receipt, get_report
  search_products     absent   not offered, so no agent here can spend a credit
  checkout            refused  MANDATE_NOT_ACTIVE — correct, and only the vault approval is missing
```

Each line is a wire nothing else exercises. "owner started" means PayPal took the browser, which a
stand-in cannot do. "permission stored" is the first proof that Neon takes a **write**. The three
tools are the D106 gate holding in production rather than in a test. And the refusal is the correct
answer, from `packages/app/src/checkout/gate.ts` — a key resolving to an agent, to a permission, to
a gate that then declines because no vault is approved. **It is not a purchase**, and nothing here
should be written up as one.

It costs nothing: a checkout prices from the free product-detail endpoint, and the one call that
spends a credit is not offered. It leaves a real owner behind on each run, which is the point —
nothing can prove a sign-up works without signing up — and the mandate it leaves is on the
deployment, so approving its link gives the deployment something it can actually charge.

**The webhook is the one wire this cannot finish.** The endpoint is provably there and provably
checking:

```
POST /api/webhooks/paypal  (unsigned body)  →  400 {"status":"rejected","reason":"BAD_SIGNATURE"}
```

A `404` would have meant the stand-in path with no PayPal keys (D74), so a `400` also proves
`PAYPAL_WEBHOOK_ID` is set — `paymentMode` needs all three PayPal values or the door is not there at
all. What it does **not** prove is that the id is the *right* one, because only a delivery that
verifies can show that. PayPal's simulator (`POST /v1/notifications/simulate-event`) does not help:
it reports the event as sent, records nothing in `/v1/notifications/webhooks-events`, and a
simulated signature can legitimately fail a correct check. So the happy path waits on a real
transaction, which is to say on G2. Hobby retains no runtime logs to inspect either — a 25-minute
window came back empty.

---

## 3 · Is a sandbox transaction tracked?

**Measured 30 Oct 2026.** One webhook is registered on the sandbox app, `PAYPAL_WEBHOOK_ID` matches
it, and it is subscribed to 8 events. Its address is a Cloudflare quick tunnel
(`*.trycloudflare.com`), which **no longer resolves** — no connection, and no `cloudflared` process
running. That is the designed local workflow rather than a misconfiguration: a quick tunnel's
address changes on every run, which is why the script re-points the same id. But while no tunnel is
up, **every delivery PayPal attempts fails.**

**`pnpm doctor:keys` answers this now**, and it is the first thing to run — it asks what PayPal has
*granted this application*, not only whether the credential is accepted.

The resolver is four branches, not one path, so the honest picture is per branch
(`packages/app/src/resolver.ts:449` onward):

| path | what it does | state |
|---|---|---|
| Webhook → `POST /api/webhooks/paypal` | PayPal reports what became of orders, captures, authorizations and vault tokens, each delivery verified against the webhook id | **not arriving** — the registered address is a dead tunnel |
| Resolver, known order id | `getOrder(orderId)` through `/v2/checkout/orders` | **working** — needs no feature |
| Resolver, inside the resend window | re-sends with the *same* `PayPal-Request-Id`, the only repeat PayPal will not charge twice for | **working** |
| Resolver, last resort | `findOrderByInvoice` — reached only when Slip never learned an order id **and** the resend window has closed | **dead** — Transaction Search |
| `reconcile` | nets settlements by invoice against PayPal's own records; stamps `reconciledAt` and `reconcileUnmatched` | **dead** — Transaction Search |

**Reconcile is not slow, it is off.** It reads PayPal's Transaction Search, and that feature is not
enabled on this sandbox app. Measured 30 Oct 2026, directly against the endpoint the code calls:

```
GET /v1/reporting/transactions → 403 NOT_AUTHORIZED
```

`search.ts` maps any non-`ok` answer to **`unknown`, never "not found"** — *"Slip has not looked, so
it may not conclude anything"* — so this **fails safe and says nothing**. Which is the right
behaviour and the reason it went unnoticed: a reconcile that cannot look is indistinguishable, from
the outside, from a reconcile that looked and found nothing wrong. `createOrderLookup`, the
double-charge check, reads the same endpoint and is equally off. `docs/SERVICES.md` carries this
with PayPal's exact error names, alongside the three closed vaulting doors.

**So the checkout and the ordinary resolve are both intact, and "nothing is tracked" would overstate
it as badly as "it is only slow" did.** A payment whose order id Slip knows is read straight back,
and that needs no feature. What is dead is everything that looks *backwards by invoice* rather than
forwards by id: the daily reconcile, and the narrow last-resort branch.

That branch has a consequence worth stating, because it is another silent one: with the grant off it
can never conclude, and `afterLookup` only fails a payment on a *definite* not-found. So a payment
whose order id was never learned and whose resend window has closed **stays open for ever** rather
than being wrongly failed. That is the right way round — Slip has not looked, so it may not conclude
— but nothing says so out loud.

And `PAYMENT.CAPTURE.REFUNDED` currently reaches Slip nowhere at all, by two independent routes: the
daily reconcile that was meant to catch it as an amount that disagrees cannot run, and the webhook
would not carry it even from a working address — that event is not one of the eight in
`SLIP_WEBHOOK_EVENTS` (`packages/paypal/src/webhooks.ts`), so fixing the delivery above does not fix
this one. That route has a second lock behind the first: even subscribed, `interpretWebhook` has no
rule for the event and answers `{kind: "ignored"}`, which `packages/paypal/src/webhooks.test.ts:221`
pins under the name *"a real event Slip has no rule for"* — so the subscription list and the
interpreter would both have to change, not just the list. [RAILS.md](RAILS.md) §8 is what it would
take.

**To fix it:** enable **Transaction Search** on the sandbox REST app — PayPal dashboard → Apps &
Credentials → your app → Features. It is a tick-box, nothing in Slip changes, and `pnpm doctor:keys`
will stop reporting it. Note that a missing grant now makes that command **exit 1**, on the grounds
that a probe which finds a silent failure and then exits 0 has only moved the silence up a level.

**To restore it locally:** start a tunnel, then re-run the command in §2.3 with its address.
**To stop needing a tunnel:** finish §2, and point it at the deployment once.

---

## 4 · Going live: the five gates

`unsafeCombination` (`apps/web/src/server/services.ts`) refuses `PAYPAL_ENV=live` unless all of
these hold. It is checked in `build()`, so the refusal lands on the first request that needs the
app — no money can move from a deployment it refuses.

| gate | why it exists | state |
|---|---|---|
| Real prices (`CHANNEL3_API_KEY`) | the stand-in catalogue's stores are invented, so a live charge would be measured against a made-up market | **shut** — the key works |
| A real steering check (`ANTHROPIC_API_KEY`) | a scripted stand-in is a receipt claiming a listing was checked when one phrase was matched | **shut** — accepted 30 Oct 2026; it was rejected earlier the same day, and the guard could not see the difference |
| Postgres, not PGlite | one process, no lock, no backup; two of them corrupt it | **shut** — Neon `slip-db`, migrated 31 Oct |
| `https` base URL | PayPal is told this hostname, and the session cookie carrying the kill switch is issued without `Secure` otherwise | **shut** — `https://slip-two-chi.vercel.app` |
| Somewhere for housekeeping | without it nothing expires a hold or finishes an unknown payment, so a real authorization sits on a real card | **open** — the secret is set and the endpoint answers by hand, but a Hobby plan sweeps **daily** against a 30-minute resend window, and no pinger-driven sweep has been seen yet (§2.4) |

§2 shut two of those three. Housekeeping is the one still open, and it is open for a reason worth
reading rather than ticking: a daily sweep is not a slow sweep, it is a missed one (§2.4). **Beyond
it, what is left is one thing and it is yours:**

**Live PayPal app credentials** — a separate app from the sandbox one, with an approved business
account. The repository has sandbox credentials only, and no amount of configuration here
substitutes for them.

**And the owner must already exist.** The sign-up page refuses to start a *new* owner under live
PayPal (D65), so create the owner under sandbox, then switch.

---

## 5 · The credentials, as of 30 Oct 2026

```
Anthropic ok             Anthropic accepted it (claude-opus-5-5)
Channel3  ok             Channel3 accepted the key and has no such product, as expected
PayPal    ok             the PayPal sandbox minted a token and has no such order, as expected
```

All three accepted, which is the first time that has been true — **and accepted is not the same as
sufficient.** The same command now also asks what PayPal has granted this application, and reports
Transaction Search as not granted (§3). A credential is the loud half: a bad key fails every
payment. A missing grant is the quiet half, and strictly worse to debug, because it leaves the
checkout perfect and kills only the backwards-looking parts, where a refusal is correctly read as
"not known" and therefore says nothing.

Run it before any deployment and before the live switch:

```sh
pnpm doctor:keys   # free; prints no part of any credential; never touches live
```

Each probe asks a question only a working credential can answer and costs nothing: `count_tokens`
for Anthropic, a product id Channel3 cannot have, an order id the sandbox cannot have. A 401 or 403
is a refusal; anything else is reported as unreachable, because a failing probe is not a failing
key.

---

## 6 · The live contract suites, run 30 Oct 2026

The offline tests check each adapter against recorded responses written from the service's own
documentation. These are the only tests that can prove the documentation, which is why SERVICES.md
calls them the gate before any demo that claims to be real. **Three of the four had never run.**

| suite | result | what it settles |
|---|---|---|
| `pnpm test:live:channel3` | **2 passed, 1 skipped** | the base url, the path, the `x-api-key` header and the key, via a product id Channel3 cannot have. The skip is the search case, which costs a credit and is opt-in twice so a keyed run never spends one by accident |
| `pnpm test:live:steering` | **14 passed** | the prompt draws the line in the right place: five examples written for SlipBench's condition C all flagged, and eight ordinary listings — *"including the loudest kind"* — none flagged. A false flag here would be Slip rejecting an honest purchase for writing sales copy |
| `pnpm test:live:bench` | **1 passed** | the agent tool loop works against the real API, asserting the mechanism and never the model's choice, before `pnpm bench:run` spends tokens on 168 runs — two agents across all four conditions |
| `pnpm test:live:paypal` | **skipped** — `skipped: set PAYPAL_TEST_VAULT_ID (pnpm test:live:paypal)` | nothing yet. This is **gate G2** |

### The three preconditions, all detected by `pnpm doctor:keys`

Each of these leaves the checkout working and breaks something that never complains, which is why a
command reports them rather than a paragraph hoping to be read:

| precondition | state | fixed by |
|---|---|---|
| a vaulted sandbox buyer | missing — **G2**, all three ways round it refused by name | a sandbox buyer login at PayPal's approval page |
| Transaction Search granted | not granted — the reconcile cannot look | a tick-box: dashboard → Apps & Credentials → your app → Features |
| the webhook pointed at this deployment | pointed at a dead tunnel | `pnpm paypal:webhook https://<host> --save` |

**One asymmetry in that command worth knowing**, because it is deliberate: a missing grant exits 1,
but a webhook pointed elsewhere exits 1 **only when PayPal could have reached this deployment**.
Events arrive over https, so with `SLIP_BASE_URL=http://localhost:3000` it reports "no address" and
does not fail. Both halves follow the same principle from opposite sides — a silent fault should fail
the gate, and a gate that fails every ordinary local run stops being read.

**The steering suite and D93 are different claims and neither substitutes for the other.** D93 swept
284 real catalogue descriptions and measured breadth: 44 of 44 planted instructions flagged, 0 of 240
honest ones. This suite takes thirteen examples chosen to probe the boundary — including text shaped
like a tool result and a closing tag — and checks the line falls between them. Breadth and boundary.

### Why `test:live:paypal` cannot run, measured

It needs a sandbox buyer whose PayPal wallet has been vaulted through the approval flow. Slip's half
of that works — two owners, two mandates, two genuine PayPal setup tokens — but the consent click
never happens, and all three ways round it are shut on this app (`docs/SERVICES.md`, with PayPal's
exact error names):

| attempt | PayPal |
|---|---|
| vault a PayPal wallet | `PAYER_ACTION_REQUIRED` — the tokens Slip created are still waiting |
| vault a card instead | `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE` |
| pay by card without vaulting | `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` |

So G2 needs a **sandbox buyer account login**, which is a human step at PayPal's approval page.
Once it exists:

```sh
PAYPAL_TEST_VAULT_ID=$(pnpm -s paypal:vault-id <mandate id>) pnpm test:live:paypal
```

`paypal:vault-id` prints only the token, so it can be captured without being shown — and it
**refuses to run while the web app is answering**, because PGlite takes no lock and two processes on
one database corrupt it. Stop the dev server first.
