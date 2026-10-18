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
| Cost | Product detail is free. **Search costs a credit, so the adapter never searches.** |
| Adapter | `packages/offers/src/channel3.ts` |

Sign up at <https://trychannel3.com> and take the key from the dashboard. Slip asks for one product
id at a time, in USD, and keeps the whole response for the receipt's audit trail.

```sh
CHANNEL3_API_KEY=… pnpm test:live:channel3
```

Two tests. The first asks for a product id that cannot exist and requires `NOT_FOUND`, which proves
the base url, the path, the header and the key at once — a rejected key answers `UNAVAILABLE`
instead. The second runs only with `CHANNEL3_TEST_PRODUCT_ID` set to a real product id, and
requires every offer Slip mapped to satisfy the domain's own `OfferSchema`: that is the real
contract, since the comparison runs on those values. Neither test spends a credit.

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
