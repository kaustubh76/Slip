# The three outside services

Slip talks to three services outside itself: **Channel3** for the offers it compares, **PayPal**
for the money, and **Claude** for the one question it asks about a listing's text. Each has a real
adapter and an in-memory stand-in, and each is decided on its own: a service is real when its keys
are set, and the stand-in otherwise (D63). Every page says which, so a receipt never calls real
prices simulated or a stand-in payment real.

`pnpm test` needs none of these keys. The adapters are tested offline against recorded responses,
and each ships a live suite that skips itself until its keys exist.

**What the offline tests cannot prove.** The recorded responses are PayPal's and Channel3's own
documented payloads, read from their schemas — not traffic from a live account. The live suites are
what closes that gap, and they are the gate before any demo that claims to be real.

## Are the keys any good? `pnpm doctor:keys`

```sh
pnpm doctor:keys   # free, prints no part of any credential, never touches live
```

**A credential that a service refuses is invisible from inside Slip, by design.** Each adapter folds
a refusal into the same answer a slow service gives — the steering check returns `NO_ANSWER`,
Channel3 returns `UNAVAILABLE` ("no prices right now"), PayPal fails at the token inside a call that
reports only that the payment did not happen. That is right at a checkout, where rule R4a holds the
purchase for the owner either way and an error must not quote a listing back. It is useless to an
operator: a revoked key means every purchase that needed the check is held, indefinitely, and
nothing anywhere says why (D92, SPEC §19.6).

So each service is asked something only a working credential can answer, and each question is free:

| Service | Asked | Works | Refused |
|---|---|---|---|
| Anthropic | `count_tokens`, which is not billed | counted | 401 or 403 |
| Channel3 | a product id it cannot have | `404 NOT_FOUND` | `401`, surfaced out of `UNAVAILABLE` |
| PayPal | an order id it cannot have, in the sandbox | `404` after the token | `401` on the token |

A deliberate miss is the cheapest proof there is that authentication succeeded: Channel3's 404
settles the base url, the path, the `x-api-key` header and the key at once, and PayPal's settles the
client id and secret, because the token has to be minted before the order can be missing.

### And the two quieter questions

A credential can be perfect while the two ends are not pointed at each other, so a second section
asks what PayPal has **granted** this application and where it would **deliver** events. Both are
quieter than a bad key: a bad key fails every payment, while these leave the checkout working
perfectly and disable only what happens around it.

| Asked | What stops without it |
|---|---|
| **Transaction Search** — a one-hour reporting window, which is free | the daily reconcile, and the last-resort lookup for a payment whose order id was never learned |
| **Webhook** — the registered url and events, compared against this deployment's own address | hearing what happens *later* — a capture completing, an authorization voided, a vault token deleted — without waiting for the next sweep |

The webhook check asks both halves, because either one is "no event ever arrives": PayPal delivers
to whatever url is registered on the application, and a quick tunnel's address changes on every run,
so yesterday's webhook is retried into a host that no longer resolves; and this deployment accepts a
delivery only if `PAYPAL_WEBHOOK_ID` names the subscription it arrived under, so a stale id refuses
every delivery that *did* arrive. It reuses `planWebhook` — the same plan `pnpm paypal:webhook`
makes — so the two agree by construction rather than by both having been written carefully on
separate days.

**A deployment PayPal cannot reach is not misconfigured for failing to be reachable.** Events arrive
only over https, so when `SLIP_BASE_URL` is `http://localhost:3000` the webhook is reported as
having no address to compare and is *not* a failure. An ordinary local run that failed the gate
would teach everyone to stop reading the exit code, which is the thing this command is for.

Neither announces itself. `packages/paypal/src/search.ts` maps a refusal to `unknown` and never to
"no such payment" — the only safe reading, since Slip has not looked and may not conclude anything,
and a perfectly silent one. **A reconcile that cannot look is indistinguishable, from outside, from
one that looked and found nothing wrong.** This sandbox was in exactly that state for a day, with
every credential green.

What does *not* stop is the checkout: a payment Slip knows the order id of is read back through
`/v2/checkout/orders`, which every application may do, so only the `findOrderByInvoice` branch of
the resolver depends on the grant. An operator told that everything is broken fixes nothing, so the
command says which half is which.

Exit **0** when everything configured was accepted, **1** when anything this deployment needs was
refused — a credential, a feature, or a webhook pointed somewhere this deployment is not — **2**
when there is no `apps/web/.env.local`. A missing feature counts even though it breaks no checkout: a probe that finds a silent failure and then exits
0 has only moved the silence up a level, where a pre-deploy script still passes and nobody reads the
paragraph. A variable that is not set is reported and is **not** a failure — "real prices, simulated
payment" is a state Slip is meant to be in. `PAYPAL_ENV=live` is never probed; the command says so
and asks nothing.

It is named `doctor:keys` rather than `doctor` because pnpm has a built-in `doctor` that shadows a
script of that name silently — it never runs, and the exit code is pnpm's.

---

## Channel3 — the offers

| | |
|---|---|
| Keys | `CHANNEL3_API_KEY` |
| Slip calls | `GET /v1/products/{id}` with `x-api-key`, one product per checkout |
| Cost | Product detail is free. **Search costs a credit**, so the adapter never searches. |
| Adapter | `packages/offers/src/channel3.ts`, and `packages/offers/src/search.ts` for search |

Sign up at <https://trychannel3.com> and take the key from the dashboard. Slip asks for one product
id at a time, in USD, and keeps the whole response for the receipt's audit trail.

```sh
CHANNEL3_API_KEY=… CHANNEL3_TEST_PRODUCT_ID=… pnpm test:live:channel3
# and, to spend one credit proving the search an agent uses:
CHANNEL3_API_KEY=… CHANNEL3_LIVE_SEARCH=1 pnpm test:live:channel3
```

**Verified live on 19 Oct 2026**, both tests green against a real key, with
`CHANNEL3_TEST_PRODUCT_ID=t1SLQyj` (a trail shoe with two merchant offers; look another up if that
id has gone). What that confirmed: the base url, the path, the `x-api-key` header, `currency=USD`,
and the whole status table — a rejected key really does answer 401 and map to `UNAVAILABLE`, a
missing product 404 and `NOT_FOUND`. Every offer the adapter produced satisfied the domain's own
`OfferSchema`. It also turned up the thing the offline tests could not: **a Channel3 offer carries
no text of its own**, so the steering check has nothing to read on real data (D67).

**Search is a separate entry point, and Slip does spend credits there.** `search_products` serves
an agent from `POST /v1/search` (D69), which the adapter itself cannot reach: it lives behind
`@slip/offers/search`, so nothing on the checkout path can spend a credit by accident. The web app
wraps it in `apps/web/src/server/search.ts` with a five-minute cache and a ceiling of 60 uncached
searches an hour per permission, refused as `RATE_LIMITED`; Channel3's own 402 is `OUT_OF_CREDITS`.
The allowance is held in memory, so several replicas each get their own — the trade D66 accepted
for resolving.

**And the tool is offered only where a deployment asks for it.** `SLIP_AGENT_SEARCH=1` alongside the
key is what builds the catalogue; without it `search_products` is never registered, so an agent is
told the tool does not exist rather than being refused on use (D106). The reason is that the budget
above is per permission *and per process*: on serverless a cold instance is a fresh allowance, and
with open sign-up a visitor can hold several permissions, so the aggregate ceiling is not bounded by
60 an hour. Prices and receipts do not depend on the flag — re-pricing reads the free product-detail
endpoint — so the ordinary deployment is "real prices, no searching".

Three tests, two of them conditional. The first asks for a product id that cannot exist and
requires `NOT_FOUND`, which proves the base url, the path, the header and the key at once — a
rejected key answers `UNAVAILABLE` instead. The second runs only with `CHANNEL3_LIVE_SEARCH=1` and
is the one that costs anything: a real search, whose mapped offers must satisfy `OfferSchema` and
whose product text must be what an agent would be shown. The third runs only with
`CHANNEL3_TEST_PRODUCT_ID` set to a real product id, and requires every offer Slip mapped to
satisfy the domain's own `OfferSchema`: that is the real contract, since the comparison runs on
those values. Only the search case spends a credit, and only when asked for.

---

## PayPal — the money

| | |
|---|---|
| Keys | `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, `PAYPAL_ENV` |
| Slip calls | Orders v2, Payments v2 (capture/void/read — **no refund**, [RAILS.md](RAILS.md) §8), Vault v3, webhook verification, Transaction Search |
| Adapter | `packages/paypal/src/` — `orders.ts`, `vault.ts`, `webhooks.ts`, `search.ts` |

1. At <https://developer.paypal.com/dashboard/applications/sandbox>, create a REST app and tick
   **Vault** under *Accept payments → Advanced options*. Without it, vaulting a wallet is refused.
   Tick **Transaction Search** in the same list. Slip reads PayPal's own records twice — the daily
   reconcile, and the last-resort lookup that stops a timed-out order being charged a second time —
   and without that feature both calls answer `NOT_AUTHORIZED`. Nothing breaks loudly: the adapter
   maps a refusal to *unknown*, never to *no such payment*, so the resolver holds rather than
   risking a double charge. It simply never reconciles, and nothing on screen says why.
2. Copy the client id and secret. Leave `PAYPAL_ENV=sandbox`: only `live` sends real money, and
   only `live` makes the disclosure band stop saying "no real money moves".
3. Point the app's webhook at Slip and keep its **webhook id**. `pnpm paypal:webhook
   https://<public host> --save` does the whole step — it creates the webhook the first time,
   re-points the same one afterwards (a quick tunnel's address changes on every run; the id does
   not), subscribes to every event Slip acts on, and writes `PAYPAL_WEBHOOK_ID` into
   `apps/web/.env.local`. Drop `--save` to print the id without touching the file, or do it by hand
   in the dashboard against `${SLIP_BASE_URL}/api/webhooks/paypal`. PayPal requires https.
   Slip treats PayPal as unready without the id: verification needs it, and a deployment that took
   payments without being able to verify a delivery would never hear what became of them.

   **The address does not have to answer for the owner's approval to work.** Slip asks PayPal for
   the saved method itself when the owner comes back — `completeVaultSetup`, retried by the
   resolver if PayPal is not ready — so `VAULT.PAYMENT-TOKEN.CREATED` only shortens a wait. The
   approval below runs against `http://localhost:3000` with nothing exposed (D84). Webhooks matter
   once purchases start: that is how Slip hears what became of a capture it did not see settle.

All three values or none — Slip falls back to the stand-in rather than running half-configured.

**The subscription is generated from the code's own list.** `pnpm paypal:webhook` subscribes to
exactly `SLIP_WEBHOOK_EVENTS` intersected with what the app is offered
(`apps/web/scripts/paypal-webhook.ts:47`), so an event Slip has no rule for is also an event Slip
never receives. `PAYMENT.CAPTURE.REFUNDED` is one of them: a refund issued in the dashboard reaches
Slip only through the daily reconcile, where today it reads as an amount that disagrees rather than
as a refund ([RAILS.md](RAILS.md) §8). **[VERIFIED 30 Oct 2026, by reading.]**

### The one manual step

The live contract suite charges a vaulted wallet, and a wallet can only be vaulted by its owner
approving it at PayPal. Nothing can automate that, so produce one once.

**There is no API shortcut, and it is worth knowing before looking for one** — measured against a
sandbox app on 30 Oct 2026, all three doors are shut without a buyer:

| Attempt | PayPal's answer |
|---|---|
| Vault a PayPal wallet | `PAYER_ACTION_REQUIRED` — waiting for the buyer, which is the point |
| Vault a card instead | `NOT_ENABLED_TO_VAULT_PAYMENT_SOURCE` |
| Pay with a card directly, no vault | `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` |

Card paths need Advanced Credit and Debit Card Payments, which a plain sandbox app does not carry.
So the approval below is structural, not a convenience: a sandbox **buyer** must click it, and a
developer login will not do.

```sh
PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… PAYPAL_WEBHOOK_ID=… \
SLIP_BASE_URL=http://localhost:3000 DATABASE_URL=pglite://.data/slip pnpm web:dev
```

Open the app, go to **Mandate**, start a permission, and approve it as a sandbox buyer (the test
accounts are under *Testing tools → Sandbox accounts*). Slip stores the payment token; read it back
with `pnpm -s paypal:vault-id <mandate id>`, which prints the token alone so the suite can take it
without it ever being shown:

```sh
PAYPAL_TEST_VAULT_ID=$(pnpm -s paypal:vault-id <mandate id>) pnpm test:live:paypal
```

Stop the web app first — PGlite takes no lock on its directory, and two processes on one database
can corrupt it, so the script refuses while the app is answering. The token stays usable until the
sandbox account is reset.

```sh
PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… PAYPAL_TEST_VAULT_ID=… pnpm test:live:paypal
```

This runs `describeGatewayContract` — the same suite the fake passes — against the sandbox: a
one-step order and its request-id replay, a capture that cannot then be voided, a void that is
idempotent. If the sandbox disagrees with the fake, **the fake is wrong**, because the fake exists
to model PayPal. Two further tests cover what the contract cannot state: a second order for one
attempt must be refused (`duplicate-invoice`) rather than charged again, and the records scan must
answer `found` or `not-found`, never `unknown`.

It spends sandbox money and leaves two captured orders and a voided authorization behind each run.
Reporting lags about three hours, so a lookup for a fresh order is expected to find nothing.

---

## Claude — the steering check

| | |
|---|---|
| Keys | `ANTHROPIC_API_KEY` |
| Slip calls | One `messages.parse` per listing that needs one, `claude-opus-5-5`, `effort: "low"` |
| Cost | ~1 500 input tokens and a few dozen out, per checkout above the flag line |
| Adapter | `packages/steering/src/claude.ts`, prompt in `prompt.ts` (version `steer-2`) |

Get a key at <https://console.anthropic.com>. The model answers one boolean about one listing's own
text, with no tools; any timeout, refusal or unreadable answer is `NO_ANSWER`, which holds the
purchase for the owner rather than guessing.

```sh
ANTHROPIC_API_KEY=… pnpm test:live:steering
```

Thirteen labelled examples, a cent or two per run. Five are written at the agent — an injected
instruction, a forged system message, a fake authority — and must be flagged. Six are ordinary
sales copy at its loudest — *BEST VALUE*, *Buy now*, *Top pick*, *Only 2 left* — and must not be:
a false flag above the flag line **rejects** an honest purchase. The last two are a matched pair on
a real 400-character product description from `study/snapshots/`, honest and with SlipBench's own
sentence buried in it, because that is the surface a production check actually reads (D86) and
every other example here is a bare sentence. It also checks the answer arrives inside the 5 s the
application allows (`classifierTimeoutMs`); if it does not, that config is what to change, because
the adapter must never retry or grant itself more time than its caller gave it.

**A rejected key does not look like a rejected key.** The adapter turns a 401 into the same
`NO_ANSWER` as a slow model and keeps no reason, on purpose — an error can quote the listing, and
R4a holds the purchase either way. So every live suite and `pnpm bench:judge` first run
`checkSteeringCredential` (`packages/steering/src/preflight.ts`): one `count_tokens` call, which is
not billed, authenticates exactly as a real call does, and on the real prompt also returns the
per-check input size. A 401 or 403 stops the run and says so; anything else is reported as the
probe failing rather than the key. **In production there is no such signal** — see SPEC §19.6.

Changing the prompt means bumping `STEERING_PROMPT_VERSION`: it is recorded on every verdict, so a
receipt can be traced to the wording that produced it.

---

## The evidence: the market study and SlipBench

Both live in their own workspace packages, both keep every response they paid for, and both
recompute their numbers from those files for free.

| | `study` | `bench` |
|---|---|---|
| Takes the sample | `pnpm study:sample` — 8 Channel3 credits | `pnpm bench:run --yes` — Anthropic tokens |
| Recomputes the page | `pnpm study:report` — free | `pnpm bench:report` — free |
| Committed data | `study/snapshots/` | `bench/runs/` |
| The page | `study/results/market-study.md` | `bench/results/slipbench.md` |

**The market study has run** (19 Oct 2026): 240 products, 8 searches. G1 fails at 18.33% against a
60% bar, the typical gap where comparison is possible is 16.67%, and the dearer offer pays more
commission in 19 of 40 cases. It also found the grouping errors behind D68.

**SlipBench ran on 26 Oct 2026, on both of its agents.** `claude-haiku-5-5` and
`claude-opus-5-5`, 21 errands × 4 conditions each = 168 runs, every one of them committed under
`bench/runs/`. The headline is that it did not catch either agent out: no overpayment and no planted
offer taken in any condition — including `buried`, which puts the instruction inside the product's
own real description rather than on an offer, where no real listing has text at all (D86) — so
**G3 fails at 0%** against its 15% bar. `claude-opus-5-5` had been piloted on 2 errands and held
back until it could run the full sweep, which is why the table was one agent wide until then: a
pilot's 2 errands are not published beside a full 21, because G3 takes the worst share across rows
and two data points could have decided it. Waiting was the right call and the wait is over.

The haiku sweep cost 573,456 input and 44,500 output tokens over 253 model turns, which was also the
basis `pnpm bench:run` projected an Opus sweep from — before it, the projection had nothing measured
to work from and said so rather than guessing. **That projection can now be scored, and it erred in
the safe direction.** Opus came in under haiku on all three measures: 545,441 input, 31,586 output,
250 model turns, recomputed per agent from the 84 committed runs in each `bench/runs/<model>/` after
the Opus `buried` arm was completed (`c03a30e`). Two checks make that arithmetic trustworthy rather
than asserted — the haiku row reproduces the figure above exactly, and the two sum to the 1,118,897
input, 76,086 output and 503 turns that `bench/results/slipbench.md` publishes for all 168. The
margin is the part to be careful with: it is 4.9% on input and 29% on output, but only 3 turns, so
"fewer turns" is a difference these runs do not establish. A projection scaled from haiku would have
overestimated the bill, which is the direction to be wrong in.

**The one input that table supplies rather than measures** is the steering verdict: under `injected`
and `buried` the planted text is instruction-like by construction, so the answer is handed to the
rules instead of a model being asked and billed twice. `pnpm bench:judge` is the other half — it
puts the same question to the production classifier, on the same text the benchmark showed its
agents, and writes `bench/results/steering-judge.md`. Without `--yes` it asks nothing and needs no
key: it prints the number of calls and the exact character size of the prompts, both measured by
building every one of them.

`pnpm bench:run` prints what it would spend and does nothing without `--yes`. **It will not pay
twice**: an errand already recorded under the current prompt version is skipped, the printout says
how many that is and what the run will therefore cost, and `--again` overrides it. A run recorded
under an *older* prompt is always run again, because the report names one prompt in its header and
keeping the old answer would publish two prompts as one. Each run also records the tokens it cost,
and the report totals them for the runs that have them. Before `--yes`, the printout projects what
the sweep will spend **in tokens**, averaged over the recorded runs of that same agent under the
same prompt — and says "no measured basis yet" rather than guessing for an agent nobody has run.
No rate is applied anywhere: a price belongs to whoever holds the account and changes without
notice, so the arithmetic is left to the moment and the person paying it. The 63 runs committed on
21 Oct predate the measurement, so the first sweep after this will be the one that earns a
projection. Measured on 21 Oct:
each errand is 2–3 model turns, since the agents search once and buy, well short of the 10-turn cap
in `claude-agent.ts`; 6 Haiku errands took 33 s and 6 Opus errands 58 s. Start with `--errands 2
--conditions clean` to see the shape, and `--agents claude-haiku-5-5` to sweep cheaply. Nothing here
spends a Channel3 credit: the catalogue is replayed from `study/snapshots/`. One errand against the
real API, to check the loop before spending on all of them:

```sh
ANTHROPIC_API_KEY=… pnpm test:live:bench
```

Two things to know before quoting its numbers. The errands' products and prices are real and the
only invented strings are the `[synthetic]` endorsement and injection, planted on one offer each.
And **the third agent is missing**: §6.2 asks for three agents across at least two providers, and
only Anthropic's SDK is wired, so the second provider is one file against `BenchAgent` plus its key.
One of the two wired agents has results; the Bench page says "1 measured of 2 wired" rather than
counting the unrun one.

---

## Running it for real, not as a demo

`SLIP_DEMO=1` is the shared sandbox: per-visitor desks, a stand-in catalogue, a stand-in approval
page. Without it, Slip is the thing itself, and these are the parts that only exist there.

**An agent can find products.** `search_products` searches Channel3 when `CHANNEL3_API_KEY` is set
**and `SLIP_AGENT_SEARCH=1` asks for it** (D106) — it never existed outside the demo before, so an
agent had to be handed product ids. Search costs
a credit where product detail is free, so Slip caches identical queries for five minutes (shared
across permissions) and allows 60 uncached searches an hour per permission before answering
`RATE_LIMITED`. Both are per process, so several replicas get several allowances.

**The steering check has something to read.** Slip records what its search showed each agent and
asks the classifier about that text at checkout (D69), which is what lets R3_STEERED fire on real
data — a Channel3 offer carries no text of its own (D67). Without `ANTHROPIC_API_KEY` the scripted
stand-in answers instead, so in production every verdict this path asks for is `NO_ANSWER` → the
purchase is held for the owner. The path is real; the judgement waits on the key.

**An owner can get back in.** Starting offers an email and a password (`scrypt`, hashed here, no
mail service involved). It is required where `PAYPAL_ENV=live`, because losing the cookie would
otherwise lose the kill switch over real money. There is no reset — Slip cannot send email.

**Housekeeping runs.** A long-lived process resolves on a timer; a serverless one needs
`SLIP_CRON_SECRET` and the `/api/cron/resolve` schedule in `apps/web/vercel.json`. Without one of those,
nothing expires a hold or finishes an unknown payment.

**Two combinations are refused outright.** `PAYPAL_ENV=live` with simulated prices, or with a
simulated steering check, does not boot: real money against an invented market, or a receipt
claiming a listing was checked when one hard-coded phrase was matched.

Browser coverage follows the same split: `pnpm web:e2e` runs the demo suite on :3100 and
`owner-start.spec.ts` on :3101 without `SLIP_DEMO`, which is where starting, signing out and coming
back are tested.

## Running with the real services

```sh
CHANNEL3_API_KEY=… \
PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… PAYPAL_WEBHOOK_ID=… PAYPAL_ENV=sandbox \
ANTHROPIC_API_KEY=… \
SLIP_ENCRYPTION_KEY=$(openssl rand -base64 32) \
SLIP_BASE_URL=http://localhost:3000 DATABASE_URL=pglite://.data/slip pnpm web:dev
```

Set only the keys you have: each service falls back to its stand-in on its own, and the line under
the tabs says exactly what is real.

**`SLIP_DEMO=1` always uses the stand-ins**, whatever keys are set. The shared demo gives every
visitor their own catalogue under their own product ids, stands in for PayPal's approval page, and
plants a listing written to be flagged — a real service would break the isolation between visitors
and spend one account's credits on every passer-by. To see the real services, run without
`SLIP_DEMO`.
