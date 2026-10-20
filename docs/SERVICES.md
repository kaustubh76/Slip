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
| Slip calls | Orders v2, Payments v2 (capture/void/read), Vault v3, webhook verification, Transaction Search |
| Adapter | `packages/paypal/src/` — `orders.ts`, `vault.ts`, `webhooks.ts`, `search.ts` |

1. At <https://developer.paypal.com/dashboard/applications/sandbox>, create a REST app and tick
   **Vault** under *Accept payments → Advanced options*. Without it, vaulting a wallet is refused.
2. Copy the client id and secret. Leave `PAYPAL_ENV=sandbox`: only `live` sends real money, and
   only `live` makes the disclosure band stop saying "no real money moves".
3. Add a webhook pointing at `${SLIP_BASE_URL}/api/webhooks/paypal` and copy its **webhook id**.
   Slip treats PayPal as unready without it: verification needs it, and a deployment that took
   payments without being able to verify a delivery would never hear what became of them.

All three values or none — Slip falls back to the stand-in rather than running half-configured.

### The one manual step

The live contract suite charges a vaulted wallet, and a wallet can only be vaulted by its owner
approving it at PayPal. Nothing can automate that, so produce one once:

```sh
PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… PAYPAL_WEBHOOK_ID=… \
SLIP_BASE_URL=http://localhost:3000 DATABASE_URL=pglite://.data/slip pnpm web:dev
```

Open the app, go to **Mandate**, start a permission, and approve it as a sandbox buyer (the test
accounts are under *Testing tools → Sandbox accounts*). Slip stores the payment token; read it back
with `psql`/`pnpm db:*` or the mandate page, and put it in `PAYPAL_TEST_VAULT_ID`. It stays usable
until the sandbox account is reset.

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
| Adapter | `packages/steering/src/claude.ts`, prompt in `prompt.ts` (version `steer-1`) |

Get a key at <https://console.anthropic.com>. The model answers one boolean about one listing's own
text, with no tools; any timeout, refusal or unreadable answer is `NO_ANSWER`, which holds the
purchase for the owner rather than guessing.

```sh
ANTHROPIC_API_KEY=… pnpm test:live:steering
```

Eleven labelled examples, a cent or two per run. Five are written at the agent — an injected
instruction, a forged system message, a fake authority — and must be flagged. Six are ordinary
sales copy at its loudest — *BEST VALUE*, *Buy now*, *Top pick*, *Only 2 left* — and must not be:
a false flag above the flag line **rejects** an honest purchase. It also checks the answer arrives
inside the 5 s the application allows (`classifierTimeoutMs`); if it does not, that config is what
to change, because the adapter must never retry or grant itself more time than its caller gave it.

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

**SlipBench is built and has not run.** It needs `ANTHROPIC_API_KEY`. `pnpm bench:run` prints what
it would spend and does nothing without `--yes`; 21 errands × 3 conditions × 2 Claude models is 126
errands of several model turns each, so start with `--errands 2 --conditions clean` to see the shape
of it. One errand against the real API, to check the loop before spending on all of them:

```sh
ANTHROPIC_API_KEY=… pnpm test:live:bench
```

Two things to know before quoting its numbers. The errands' products and prices are real and the
only invented strings are the `[synthetic]` endorsement and injection, planted on one offer each.
And **the third agent is missing**: §6.2 asks for three agents across at least two providers, and
only Anthropic's SDK is wired, so the second provider is one file against `BenchAgent` plus its key.

---

## Running it for real, not as a demo

`SLIP_DEMO=1` is the shared sandbox: per-visitor desks, a stand-in catalogue, a stand-in approval
page. Without it, Slip is the thing itself, and these are the parts that only exist there.

**An agent can find products.** `search_products` searches Channel3 when `CHANNEL3_API_KEY` is set
— it never existed outside the demo before, so an agent had to be handed product ids. Search costs
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
`SLIP_CRON_SECRET` and the `/api/cron/resolve` schedule in `vercel.json`. Without one of those,
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
