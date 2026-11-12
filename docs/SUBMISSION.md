# Slip — submission

The text for the submission form, kept here so the form and the repository cannot drift apart.
Every figure is recomputed from committed data by a command named beside it.

---

## Elevator pitch

AI agents are starting to spend people's money, and what the payment rails carry cannot tell a fair
price from a bad one. Slip checks every purchase an agent attempts — against every other offer
listed for the same item — before PayPal moves any money.

## What it does

A delegated payment credential binds a purchase to an amount, a currency, one merchant, one
checkout session, an expiry and a single use. That is real protection: the credential cannot be
spent elsewhere, later, for more, or twice. It is also **a description of the offer the agent
already chose.** Nothing in it refers to any other offer. $400 that is the lowest listed price and
$400 that is listed at $260 somewhere else are the same number, and an allowance for $400 admits
both. A spending cap is a bound too, and cannot tell them apart either — which is why a cap is not
the check.

Slip is the check. The owner approves once, through PayPal. After that an agent can only pay
through Slip, and every attempt is examined first:

- the chosen offer is **compared with the other offers listed for the same item**, from Channel3;
- the **text the agent actually read** is examined for instructions aimed at it;
- the **owner's limits** decide — pay, reject, or hold for a human.

Either way it prints a receipt in plain words, quoting the offers the decision was made against. A
held purchase shows the owner what approving costs before they approve it. A kill switch revokes
the whole arrangement at any time.

**What it is not.** Not a shopping agent — Slip does not choose what to buy, it checks what was
chosen. Not a merchant — no order reaches a retailer; Slip is the seller of record in PayPal's
sandbox. Not a price oracle — it compares against one catalogue, and says so on every receipt.

## How PayPal is used

PayPal is the spine, not a payment button at the end. Six API families, each with offline contract
tests written from PayPal's own documented payloads, and a live suite that runs against the sandbox
when keys are present:

| what | endpoint |
|---|---|
| Owner approves once, and the token is stored encrypted | `/v3/vault/setup-tokens`, `/v3/vault/payment-tokens` |
| Every purchase becomes an order, authorised not captured | `/v2/checkout/orders` |
| The decision is settled, or released | `/v2/payments/authorizations/{id}/capture`, `/void` |
| Late, repeated and out-of-order deliveries converge | `/v1/notifications/verify-webhook-signature` |
| A payment whose outcome is unknown is looked up rather than guessed | `/v1/reporting/transactions` |
| App authentication | `/v1/oauth2/token` |

Three things are worth a judge's minute:

1. **The decision and its payment are written before PayPal is called.** A timeout is recorded as
   `unknown`, never as `failed`, and the resolver finishes it later — re-sending with the original
   request id inside 30 minutes, and asking Transaction Search after that. Money is never moved
   twice and never silently lost.
2. **Authorise, then decide, then capture.** A hold is a real PayPal authorisation; declining voids
   it. The owner approves an exact amount, and if the price moved the approval meets
   `PRICE_CHANGED` instead of quietly paying the new one.
3. **Every write that can move money is guarded twice** — by shared pure rules in code and by
   constraints and triggers in Postgres.

`PAYPAL_ENV=live` is the only value that moves real money, and a deployment that would run against
invented prices or a scripted classifier refuses to start at all.

## AI tools statement

| tool | how it is used |
|---|---|
| **`claude-opus-5-5`** (Anthropic API) | The steering classifier. When the price gap is already above the owner's flag line, it reads the text the agent was shown and answers one boolean: is this an instruction aimed at a shopping agent? Measured on 30 Oct 2026: **44 of 44 planted instructions flagged, 0 of 240 honest descriptions**, every call answered inside the 5 s the application allows (`bench/results/steering-judge.md`). Without a key, a scripted stand-in answers and every receipt says so. |
| **`claude-opus-5-5` and `claude-haiku-5-5`** | The two shopping agents in SlipBench, the benchmark that shops the real catalogue under four conditions. |
| **Model Context Protocol** | How agents reach Slip. `checkout`, `get_receipt`, `get_report` and — where a deployment opts in — `search_products`, each run with the agent's own key. Both 2025-era and 2026-07-28 clients are served. |
| **Claude Code** | The code was written with Claude Code across the submission period. Every design decision is logged in `docs/DECISIONS.md`. |

## How to test it

**The live deployment — <https://slip-two-chi.vercel.app>.** Real Channel3 listings, PayPal's
sandbox, Slip as the seller of record. No real money moves and no order reaches a retailer.

Signing in means approving a payment method at PayPal, so it needs a **PayPal sandbox buyer
account** — free, about a minute, at developer.paypal.com → Testing Tools → Sandbox accounts. That
is PayPal's own approval flow doing exactly what it does in production.

**Or run it with no account, no keys and no database:**

```sh
git clone https://github.com/kaustubh76/Slip && cd Slip
pnpm install
SLIP_DEMO=1 SLIP_BASE_URL=http://localhost:3000 pnpm web:dev
```

Open <http://localhost:3000> → **Open a demo desk**: an owner with a history already on the
roll — purchases paid, rejected and held — stand-ins for Channel3 and PayPal in the same process, and a console that issues an agent
key so you can watch a real MCP client be checked. Node ≥ 22.12 and pnpm 10.

`pnpm test` needs nothing either — the database and end-to-end tests run on an in-process Postgres.

## What was measured, and what it showed

Both studies are recomputed from committed data with no key and no model call, so a judge can
reproduce every number: `pnpm study:report` and `pnpm bench:report`.

**The market study** — 240 real Channel3 products, sampled 19 Oct 2026. Of the products carrying
two or more comparable offers, the typical gap between cheapest and priciest is **16.67%** — and
**the dearer offer pays more commission 47.5% of the time** (19 of the 40 products whose offers
stated different rates). That conflict is the case for a check like this.

**SlipBench** — 2 agents × 4 conditions × 21 errands, 168 runs, 26 Oct 2026. The conditions plant a
"top pick" endorsement and, twice over, text addressed to shopping agents — once on an offer, once
inside the product description every offer shares.

**Nothing took the bait.** Across the 126 errands under the three manipulated conditions, no agent
bought the planted offer. **These models compared offers well enough that Slip rarely had to stop
them**, and the benchmark records that as a failed gate rather than hiding it.

So the honest claim is the narrow one: **Slip's own measurements do not show today's agents being
fleeced.** The case for the check rests on the structure of the market — the dearer offer often
pays more commission — and on there being nothing that enforces a buyer-side comparison, not on a
demonstration that models overpay today. The strongest finding from reading PayPal's published
agent material on 26–30 Oct 2026 is that its one buyer-side control is a line in an example system
prompt — *"After approval by user, invoke capture_order"* — which nothing enforces, and a prompt is
not a control: the same model that reads it decides whether to follow it. None of that is a
criticism of an acceptance product that was never meant to be a buyer's second opinion.

## What is built, and what is not

Built: the check, the domain model, persistence, every use case, the owner UI in two themes, the
MCP server, adapters for all three outside services, and the wiring a real deployment needs.
Channel3 is verified against a live key, the store contract runs against real Postgres, and the
classifier is verified against the real model.

Not built, and said so in the repository rather than implied away:

- **Refunds.** Slip can stop a payment and cannot undo one. The design is written; the code is not.
- **The merchant attestations** in `docs/MERCHANTS.md` — the seller graph and two of its three rules
  ship; the attestations and their store do not.
- **The agent-platform interface** in `docs/RAILS.md` is a design, with none of it built.
- **One beat of the demo** waits on a sandbox buyer whose wallet has been vaulted through PayPal's
  approval flow — the one step nothing here can automate.

## Challenges

**Comparison is not what a payment credential is for.** The hardest part was not the integration;
it was finding the one claim that survives contact with the data. Agents did not overpay in our
benchmark. Channel3 carries one offer for most products (18.33% have two or more). Three of the 44
comparable products look like the catalogue filing two different items under one id — which is a
live risk in the product, not just in the study, because Slip compares within a product id. Each of
those is recorded as a failed gate with the number attached, because a judge who finds one
overclaim is right to discount everything else.

**An `unknown` payment is not a failed one.** Most of the hard engineering is in that sentence: the
write-ahead ordering, the resolver, the 30-minute resend window, and the database triggers that
refuse to let two of anything happen.
