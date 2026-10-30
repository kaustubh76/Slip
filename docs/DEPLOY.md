# SLIP — Deploying it, and what each deployment can prove

**Prepared:** 30 October 2026 · **Companion to:** [SERVICES.md](SERVICES.md) (the three outside
services), [SPEC.md](SPEC.md) §19.6 (the credential hole)
**Status:** the demo Blueprint and the container are built and verified; the Vercel project is
**not created** — see §2.1. Nothing here sets `PAYPAL_ENV=live`.

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

### 2.1 Blocked, and on what

**The project does not exist yet.** Creating it returned **403 forbidden** — the Vercel connector
available here can read projects but not create them, and `list_integration_configurations` is
likewise forbidden, so a database cannot be provisioned through it either. There is no Vercel CLI
installed locally to fall back to. Any one of these unblocks it:

- create the project in the Vercel dashboard, then grant the connector write access to it;
- widen the connector's scope to allow project creation;
- `npm i -g vercel && vercel login`, after which the whole of §2.2 can be done from here.

**And `DATABASE_URL` must be a real Postgres.** PGlite is a single-process file store, so on
serverless each instance would get its own copy and the app would be incoherent. Any connection
string works; Neon and Supabase both have a free tier.

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

Also set `ANTHROPIC_API_KEY`, which as of 30 Oct 2026 is accepted — see §5. **Not set:**
`SLIP_DEMO`, since demo mode is refused on Vercel anyway.

The rule that key has to follow is worth keeping even now that it works. A *missing* key makes the
steering check the scripted stand-in, which every receipt then says plainly. A **rejected** key is
worse than none: `resolveServices` only checks that the variable is *present*, so Slip would report
a real classifier while holding every purchase whose price gap needed one, with a receipt that reads
exactly like a slow model (SPEC §19.6). Only `pnpm doctor:keys` tells the two apart — so it is the
pre-flight before a deployment, not only before going live.

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

And `PAYMENT.CAPTURE.REFUNDED` currently reaches Slip nowhere at all: the webhook is not arriving,
and the daily reconcile that was meant to catch it as an amount that disagrees cannot run.

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
| Postgres, not PGlite | one process, no lock, no backup; two of them corrupt it | **open** — currently `pglite://` |
| `https` base URL | PayPal is told this hostname, and the session cookie carrying the kill switch is issued without `Secure` otherwise | **open** — currently `http://localhost:3000` |
| Somewhere for housekeeping | without it nothing expires a hold or finishes an unknown payment, so a real authorization sits on a real card | **open** — no cron secret set |

Finishing §2 shuts the remaining three. **What is then left is one thing, and it is yours:**

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
| `pnpm test:live:bench` | **1 passed** | the agent tool loop works against the real API, asserting the mechanism and never the model's choice, before `pnpm bench:run` spends tokens on 126 errands |
| `pnpm test:live:paypal` | **skipped** — `skipped: set PAYPAL_TEST_VAULT_ID (pnpm test:live:paypal)` | nothing yet. This is **gate G2** |

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
