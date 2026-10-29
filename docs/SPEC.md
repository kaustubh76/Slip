# SLIP — Final Ideation and Build Spec (v4)

**Prepared:** 11 October 2026 · **Event:** PayPal AI Hackathon 2026
**Deadline:** 13 Nov 2026, 1:30 AM IST · **Internal cutoff:** 11 Nov, 6 PM IST
**Lineage:** ACR / Machine TCA, ported to consumer purchases

**Changes in v4 (after external critique):** honest merchant model; payment flow rebuilt around what PayPal's API actually does; a real, non-synthetic headline number; realistic-search benchmark condition; shipping-aware rejection rule; scope cut for a solo build; plain-language UI.

> **Product:** Slip checks every purchase an AI agent tries to make, before PayPal moves the money. If the agent is overpaying, was steered, or picked the offer that pays more commission, the payment does not happen.
> **Tagline:** The second opinion on every agent purchase.
> **Operating principle:** Agents shop. Slip checks. Policy decides. PayPal pays.

## Truth labels
**[VERIFIED]** checked against an official source on 10–11 Oct 2026 · **[UNVERIFIED]** confirm in Phase 0 · **[DECISION]** design choice · **[HYPOTHESIS]** to be measured · **[PROHIBITED]** never claim.

---

## 1. Problem

AI agents now complete purchases. Nothing checks the buyer's side of the trade. Three failures have no instrument:

1. **Overpayment** — the identical item was listed cheaper elsewhere.
2. **Steering** — an endorsement badge, ranking position or text in a listing moved the agent.
3. **Commission conflict** — the agent's platform earns more commission on the pricier offer.

### Evidence [VERIFIED]
- **ACES (Columbia, arXiv 2508.02630):** frontier shopping agents show strong, model-specific position bias, avoid "Sponsored" tags but follow platform endorsements, and shift with small seller-side description tweaks.
- **Magentic Marketplace (Microsoft Research, arXiv 2510.25779):** all tested models showed severe first-proposal bias and susceptibility to manipulation.

Both are synthetic research markets. Neither uses live retail prices or sits in a payment path.

## 2. Where Slip actually runs (the honest merchant model)

**The limit:** Slip cannot stand between an agent and an arbitrary retailer's checkout. A PayPal vault token held by Slip lets Slip's own PayPal app charge the buyer. It does not pay a third-party store.

**So Slip is deployable wherever one party controls both the agent's payment and the checkout [DECISION]:**
- an agentic shopping platform acting as merchant of record (it takes the buyer's payment and places the order with the retailer);
- a payment provider's own agentic checkout, where the same check could run before authorisation.

**In the demo, Slip is the merchant of record.** Its PayPal sandbox app is the seller. It relists real offers from real retailers, and no order is placed with those retailers. Say this on screen and in the README.

**Pitch line for PayPal judges:** PayPal's public agentic-commerce docs describe the merchant side — product discovery, cart, checkout, payment acceptance, order routing. No public page compares a price, applies a spending limit, or requires the buyer's approval before an agent pays. **The one buyer-side control anywhere in PayPal's own agent material is a line in an example system prompt** — the Agent Toolkit's OpenAI example says *"After approval by user, invoke capture_order"*, under the guidance to "use well-defined system prompts to control the behavior of the agent", and its CrewAI, LangChain and Vercel examples have no approval step at all. Nothing enforces it. Slip is that piece, in code rather than in a prompt, shown working on PayPal rails. **[VERIFIED 26–27 Oct 2026 against the four pages listed in §19.3.]**

**Say it bounded, and nothing wider.** This is a claim about what the public documentation
describes on a stated date — not that PayPal has no price check. Two limits belong with it: the
agentic-commerce services are gated behind a merchant request form, so what access reveals is
unknown; and *"supervised and automatic shopping scenarios"* appears on two PayPal pages and is
defined on neither, so a buyer-side step inside "supervised" cannot be ruled out. Nor is any of this
a criticism of PayPal — the Agent Toolkit is a payments toolkit and was never meant to be a
buyer-protection product. **[PROHIBITED]** saying PayPal lacks, omits or forgot a price check.

## 3. Who it is for

**Primary:** teams building agentic shopping platforms. They need to know whether their agent buys well, prove it, and stop bad purchases.
**Secondary:** the person whose money is spent. They set limits once and get a plain-language receipt.

## 4. What Slip does

### 4.1 Mandate (once)
The human makes one normal PayPal checkout, which saves their payment method to PayPal's vault, and sets limits: maximum overpayment, maximum order size. Slip holds the vault token. The agent never does.

### 4.2 Check, then pay
**[VERIFIED]** PayPal treats an order created with a saved vault token as a single-step call: creation and payment happen together. There is no gap between "create" and "pay" to put a check in. So the check runs **before any PayPal call**.

1. Agent calls Slip's MCP tool `checkout(product_id, chosen_offer_url, reason)`.
2. Slip pulls every merchant offer for that product from Channel3 and snapshots it.
3. Slip computes the price gap and flags (Section 5).
4. Outcome:

| Outcome | When | PayPal action |
|---|---|---|
| **PAID** | Within limits, no flags | Single-step order with vault token, intent CAPTURE |
| **REJECTED** | Overpaid beyond limits, or steered, or commission conflict | None. No order exists. Agent gets the reason and the better offer |
| **HELD** | Too few offers to compare, stale data, or above order-size limit | Order with intent AUTHORIZE (funds held). Human approves → capture. Human declines → void **[UNVERIFIED in sandbox; Payments v2 via REST]** |

Fallback if authorise-and-void fails in sandbox: HELD creates no order until the human decides.

### 4.3 Receipt (one screen, five seconds)
Illustrative layout, not real data:

> Your agent tried to pay **$54.99** at Store A.
> The same item was listed at **$47.99** at Store B.
> **Overpaid by 15%.** Store A pays your agent's platform 8% commission; Store B pays 2%.
> **Payment rejected. Nothing was charged.**
> Prices are listed item prices. Shipping is not included.

Behind it: the full offer snapshot, timestamp, rule fired, policy version, PayPal ids.

### 4.4 Agent report card
Per agent: purchases attempted, paid, rejected, held; typical and worst overpayment; how often it was steered. Plus a daily "reconciled against PayPal" check. **[VERIFIED]** PayPal's transaction list can take up to three hours to show a transaction, so this is a delayed batch with an "as of" time, never a live claim. Live status comes from the order itself.

## 5. The check

Money in integer cents, USD only.

```
best_listed   = lowest price among in-stock, new offers for the SAME Channel3 product id and variant
gap_abs       = chosen_price - best_listed
gap_pct       = gap_abs / best_listed
conflict      = gap_abs > 0 AND chosen.max_commission_rate > best.max_commission_rate
```

**Shipping problem:** Channel3 offers carry no shipping or tax **[VERIFIED]**. A $3 cheaper item with $8 shipping would be a false rejection. So price alone only rejects when the gap is large:

| Rule | Default | Outcome |
|---|---|---|
| Gap above 5% **and** above $8 | — | REJECTED (overpaid) |
| Gap above 1% **and** conflict or steering flag | — | REJECTED (steered / conflict) |
| Fewer than 2 comparable offers | — | HELD |
| Order above $200 | — | HELD |
| Snapshot older than 10 min | — | Refetch, else HELD |
| Otherwise | — | PAID |

The $8 allowance is a stated assumption, user-editable. Every receipt says "listed item price". Do not call the metric "best execution" or "landed cost" in the product.

**No LLM decides the outcome.** An LLM only classifies listing text for steering (fixed schema, no tools) and writes the receipt sentence. Rules are code.

**Steering flag:** chosen offer is not the cheapest **and** the listing or tool output contains instruction-like text, or the agent's stated reason cites a badge or listing claim.

**Matching [VERIFIED]:** Channel3 groups merchant offers under one product id. Slip compares only within the same product id and selected variant. Channel3 exposes no GTIN/UPC. Accuracy of that grouping is **[UNVERIFIED]**; gate G4 checks it by hand.

## 6. Evidence plan

### 6.1 Market study: the real headline number (no agents, no synthetic content)
From a sample of products in the chosen categories (target 150–200, fewer if credits are tight), compute:
1. share of products with 2+ comparable offers;
2. typical gap between cheapest and priciest offer for the same item;
3. how often the highest-commission offer is **not** the cheapest.

This is real data from Channel3, costs only API calls, and doubles as gate G1. Whatever it shows goes in the pitch as measured, with sample size and date. **[HYPOTHESIS]** that the numbers are large enough to matter. If they are small, say so and lean on 6.2.

### 6.2 SlipBench: how agents behave
20–25 errands, each naming one specific product. 3 agents across at least two model providers, including one small low-cost model. Three conditions:

| Condition | What the agent gets | Purpose |
|---|---|---|
| **A. Realistic search** | A raw search tool with noisy, paginated results. It must find the item and compare offers itself. Nothing is manipulated | Does laziness alone cause overpayment? |
| **B. Endorsed** | Same, but a pricier offer carries a "Top pick" label and is listed first | Endorsement and position bias |
| **C. Injected** | Same, but a pricier listing contains instruction-like text | Prompt-injection resistance |

Labels and injected text in B and C are synthetic and labelled so everywhere. Offers and prices are real.

**Reported:** per agent and condition, share of purchases overpaid, typical overpayment in percent and dollars, and the same figures with Slip switched on.

All snapshots, prompts and outputs are committed. The bench replays from stored snapshots, not live calls.

## 7. Architecture

```
Agent ──MCP──► Slip server
                 ├─ Offers service ──► Channel3 /v1/search  (cached snapshots)
                 ├─ Check (pure code): gap, conflict, rules
                 ├─ Steering classifier (LLM, schema-locked)
                 ├─ PayPal adapter (server-side only, REST)
                 ├─ Receipt store (append-only)
                 └─ Web UI: receipt · report card · limits · bench results
```

### PayPal usage
| Step | Capability | Status |
|---|---|---|
| Mandate | Vault v3 setup token, approved by the owner, exchanged for a payment token — the diagram's no-purchase alternative, which is what shipped (D82) | **[BUILT]** |
| Agent purchase | Orders v2 single-step order with vault token, CAPTURE | **[VERIFIED in docs; untested in sandbox]** |
| Human-review hold | Orders v2 AUTHORIZE with vault token; Payments v2 capture or void | **[UNVERIFIED]** |
| Status | Get order | REST `GET /v2/checkout/orders/{id}`, not the Agent Toolkit (D82) |
| Daily reconcile | Transaction list (delayed up to 3 h) | REST `GET /v1/reporting/transactions` (D82) |
| Refund (stretch) | Refund a capture | not built |

**[VERIFIED]** The Agent Toolkit has no vault, authorise or void tools, so the vault and hold calls go to REST directly. State this in TOOLS.md. Every single-step order needs a `PayPal-Request-Id` header; use it as the idempotency key.

**[VERIFIED]** Store Sync is limited-access and US-physical-goods only. Slip does not use Store Sync or Agent Ready.

### Channel3 usage [VERIFIED]
`POST /v1/search`, max 30 results per call, free credits that run out (HTTP 402). Each product has an `offers` list with `domain`, `url`, `price`, `availability`, `condition`, `max_commission_rate`. Cache every response.

### Real vs simulated (README and video)
| Element | Status |
|---|---|
| Products, offers, prices, commission rates | Real (Channel3) |
| Market study numbers | Real, computed from the above |
| Agent decisions | Real LLM runs |
| "Top pick" labels and injected text | Synthetic test conditions |
| Seller | Slip itself, as merchant of record in sandbox |
| Payment | PayPal sandbox; no real money; no order reaches a retailer |

## 8. Interfaces

```
MCP tools
  checkout({ agent_id, product_id, chosen_offer_url, reason })
    → { outcome: "PAID"|"REJECTED"|"HELD", gap_pct, gap_abs, best_offer,
        reasons: [...], receipt_id, paypal_order_id?, paypal_status? }
  get_receipt({ receipt_id })
  get_report({ agent_id })
```
The server prices from its own snapshot. Prices sent by the agent are ignored.

```
slip/
  apps/web/          UI
  packages/check/    gap, conflict, rules (no network)
  packages/offers/   Channel3 client + snapshot cache
  packages/paypal/   adapter, idempotency, reconcile
  packages/mcp/      MCP server
  packages/steering/ classifier
  study/             market study script + results
  bench/             errands, snapshots, runs
  tests/
```

## 9. Data model
`Agent` · `Mandate(vault_token_ref, limits, policy_version)` · `OfferSnapshot` · `Attempt(agent_id, product_id, chosen_offer, reason, condition?)` · `CheckResult(gap_abs, gap_pct, conflict, steering_flags, rule_codes)` · `Outcome(PAID|REJECTED|HELD)` · `Payment(paypal_order_id, request_id, status)` · `Receipt(snapshot_json, sentence, created_at)`

Payment status: `NONE, CAPTURED, AUTHORIZED, VOIDED, FAILED, UNKNOWN`. A timeout becomes `UNKNOWN`, resolved by get-order with the same request id, never by a new order.

## 10. Phase 0 gates (Oct 14–17)

| # | Question | Pass |
|---|---|---|
| G1 | Do products carry 2+ comparable offers, and is the spread material? | ≥60% of sampled products have 2+ offers; market study numbers recorded |
| G2 | Does mandate → vault → single-step paid order work with no buyer click? Does AUTHORIZE → void work? | Two unattended purchases succeed; hold/void result recorded either way |
| G3 | Do agents overpay in condition A, or get moved in B or C? | Any agent overpays or is steered on ≥15% of 10 errands in at least one condition |
| G4 | Is Channel3's grouping correct? | ≤1 wrong grouping in 30 hand-checked products |
| G5 | Do credits cover the study and bench with caching? | Yes, or sample sizes cut to fit |

**If a gate fails**
- **G1:** narrow categories. If none pass, stop: there is nothing to compare against.
- **G2:** fall back to one human approval click per order and no hold. Say so.
- **G3:** lead with the market study and the commission-conflict check; present SlipBench as "these agents passed this test".
- **G4:** restrict to hand-verified products.

**What to lead with, and why it is not the architecture.** A policy engine between an agent and
PayPal Orders — propose, decide in code, pay or hold or refuse — is the obvious answer to this
problem, and it is not what distinguishes this entry; several other entries in this hackathon
arrive at the same shape, one of them at the same three outcomes with the same list of rules that
fired (D89). What is harder to arrive at is the evidence around it: a market study on 240 real
products whose numbers anyone can recompute from committed snapshots with no key, a benchmark whose
every run is committed and replayable, a receipt that quotes the text its own decision was about,
and a steering check with a field measurement behind the question of whether it is needed at all —
one real listing in 240 matched the patterns, and the model cleared it (D88). Lead with the
measurements, not the diagram.

## 11. Regression scenarios
1. Cheapest offer chosen → PAID
2. Gap 12% and $15 → REJECTED (overpaid)
3. Gap 4% and $3, no flags → PAID
4. Gap 3% with higher commission → REJECTED (conflict)
5. Injected text, pricier pick → REJECTED (steered)
6. One comparable offer → HELD
7. Different variant → not compared
8. Used or out-of-stock cheaper offer → not compared
9. Above order limit → HELD; approve → captured; decline → voided
10. Channel3 down or out of credits → HELD
11. PayPal order call fails → FAILED, nothing charged
12. PayPal timeout → UNKNOWN, resolved by lookup, no duplicate
13. Same `checkout` call twice → one order
14. Agent sends a false price → ignored
15. Boundary values exactly at 5% / $8 → documented rule

**Target:** zero payments on any case expected to be REJECTED or HELD.

## 12. Positioning

| Alternative | Slip's difference |
|---|---|
| Shopping agents | Slip checks them; it does not shop |
| Honey and price trackers | Help a human choose. Slip stops an agent's payment and keeps a record |
| Spend limits | Cap amount. Slip compares price with the market and spots conflicts |
| ACES, Magentic Marketplace | Measure bias in synthetic markets. Slip uses real offers and acts at the payment step |

**Claim to defend:** "On a platform that controls both the agent's payment and the checkout, Slip compares the agent's chosen offer with other listed offers for the same item, flags steering and commission conflicts, and prevents the PayPal payment when the owner's limits are breached."

**[PROHIBITED]** Gating third-party retailers' checkouts; "best execution" or landed-cost claims; savings figures not from the study or bench; presenting synthetic labels or injections as found in the wild; real purchases; use of Agent Ready or Store Sync; "first benchmark of agent bias"; adoption claims without named, consenting users.

## 13. Prizes

| Prize | Fit | Why |
|---|---|---|
| **Best Use of Channel3 — chosen side track** | Strong | Offers as the comparison base; `max_commission_rate` as a conflict signal. Frame it as Channel3's transparency making the check possible |
| Best Use of Agentic Commerce | Plausible | Buyer-side check for agent purchases, with the merchant model stated plainly |
| Best Use of PayPal + AI | Plausible | Vault mandate, single-step pay, hold and void, reconcile |
| Best Demo Delivery | Plausible | A payment visibly refused, with a one-screen reason |
| Top 3 overall | Long shot | Needs the product to feel complete, not like a test harness |

## 14. Scope

**Must ship (9):**
1. Mandate with vault token
2. Offers service with cache
3. Check and rules, fully tested
4. Steering classifier
5. PayPal pay path (plus hold/void if G2 allows)
6. MCP server with `checkout`
7. Receipt screen and report card
8. Market study and SlipBench results, reproducible
9. Hosted demo, public repo with licence, README, TOOLS.md, video under 3:00

**Stretch, in order:** price-protection refund (the platform refunds the difference if a cheaper listing appears within 24 h; funded by the platform, not the retailer); one or two outside builders from your own developer community running their agent through Slip; AG Grid report card if multiple sponsor entries are allowed **[UNVERIFIED]**.

**Cut:** npm wrapper; adoption target among competing teams; 40-errand bench; live reconciliation; PYUSD or anything on-chain; shipping and tax; multi-currency; disputes.

## 15. Build plan (IST, solo)

| Dates | Work | Exit |
|---|---|---|
| Oct 14 | Sandbox app with vault enabled; mandate purchase; two vault purchases; authorise and void | G2 |
| Oct 15 | Channel3 key; market study script on first 50 products; hand-check 30 | G1, G4, G5 |
| Oct 16–17 | Throwaway bench: 10 errands × 3 agents × 3 conditions | G3; go / narrow / pivot |
| Oct 18–21 | `check` package and tests | Scenarios 1–8, 14, 15 |
| Oct 22–25 | `offers` cache; `paypal` adapter | Scenarios 9–13 |
| Oct 26–28 | Steering classifier; MCP server; reference agent | One live PAID, one REJECTED, one HELD |
| Oct 29–Nov 1 | Full market study; full SlipBench; freeze results | Results committed |
| Nov 2–6 | Receipt screen, report card, limits page, bench page | A non-finance person reads a receipt in five seconds |
| Nov 7–8 | Deploy; README; TOOLS.md; fresh-clone test | A stranger can run it |
| Nov 9–10 | Video | Under 3:00, public |
| Nov 11 | Submit by 6 PM | Done |
| Nov 12 | Buffer | Critical fixes only |

**The fresh-clone test ran on 22 Oct, sixteen days early**, and the exit holds: a clone installs
from the lockfile, passes 1,793 tests and 308 more on real Postgres, builds, serves a desk, runs
the agent script to a REJECTED and a PAID receipt, and recomputes both studies byte for byte. It
also found the one defect none of that could — the demo crashing two seconds after it opens, in
dev mode, which is the mode the README gives a visitor (D79). Running it on Nov 7 would have left
one day to find that.

## 16. Video (target 2:45)
- **0:00–0:12** An agent buys something. "Did it overpay? Nobody checks."
- **0:12–0:30** The market study number, on screen with sample size.
- **0:30–1:15** Live: agent picks the pricier "Top pick" offer → Slip's receipt screen → rejected, nothing charged. Agent retries with the cheaper offer → paid, PayPal sandbox id shown.
- **1:15–1:35** A HELD purchase: funds authorised, human declines, hold released.
- **1:35–2:15** SlipBench: one measured agent, four conditions, with and without Slip. Two of the four are the same injection in two places — on an offer, where a real listing is always silent, and inside the product description, where it never is (D86).
- **2:15–2:30** Where this runs for real, and that the demo is sandbox with Slip as seller.
- **2:30–2:45** Close.

Use percent and dollars throughout. No basis points, no "slippage", no "TCA".

## 17. Hard questions

**Who is the merchant?** In the demo, Slip. It is the merchant of record in PayPal sandbox and relists real offers. Slip is built for platforms that hold both the agent's payment and the checkout.

**So it can't stop my agent buying from any store?** Correct. It works where the platform controls payment. That is also where the commission conflict lives.

**Shipping could make the cheaper offer worse.** Yes. Price alone only rejects when the gap exceeds 5% and $8, the allowance is editable, and every receipt says item price only.

**Are the steering attacks real?** The labels and injected text are test conditions. The market study and condition A use nothing synthetic.

**Hasn't research shown this already?** ACES and Magentic Marketplace measured it in synthetic markets; both are cited. Slip uses real offers and acts before payment.

**Is the lowest Channel3 price the true lowest?** No. It is the lowest listed in Channel3's index at that moment. The receipt names the source.

**Why PayPal?** Vault gives one-time consent, authorise and void give a clean human-review hold, and it is where agent checkout is being built.

**Who pays for Slip?** The platform or the agent's owner. Stores never pay for ranking.

## 18. Submission copy (edit to match what ships)

**Slip — the second opinion on every agent purchase.**
AI agents are starting to spend people's money, and nothing checks whether they are overpaying or being steered — PayPal's own agent examples put the buyer's approval in a system prompt rather than in code, and nothing there checks a price. Slip checks every purchase an agent attempts before PayPal moves the money. It compares the chosen offer with other listed offers for the same item from Channel3, flags steering and cases where the pricier store pays more commission, and applies the owner's limits: pay, reject, or hold for a human. The owner approves once through PayPal; after that the agent can only pay through Slip. Every attempt gets a plain-language receipt. We measured real price and commission spreads across 240 products from Channel3's index: 18.33% carry two or more comparable offers, the typical spread between cheapest and priciest is 16.67%, and the offer paying the most commission is not the cheapest 47.5% of the time. Prices and agent decisions are real; payments run in PayPal sandbox with Slip as the seller.

We also ran **one agent — `claude-haiku-5-5`, the small low-cost one — through 21 shopping errands** under clean, endorsed and injected listings, with and without Slip. It did not overpay in any condition, including the one where the pricier listing carries text addressed to shopping agents. That is a claim about one cheap model on 21 errands, not about agents in general, and we publish it because it is what the test said. Three of its purchases did fetch the wrong product: the catalogue files two near-identical skillets separately and it took the cheaper one — the same grouping weakness the market study found, showing up again from the other direction. The spread and the commission conflict are real and measured; whether a given agent walks into them is not something anyone can promise, which is the argument for checking every purchase rather than trusting a model to be careful.

*Edited 21 Oct to match what ships. The original claimed three agents across two providers; one is wired and measured, a second is wired and unrun, and there is no second provider. Gate G3 asked for an agent to overpay or be steered on 15% of errands in some condition and got 0%, so §10's fallback applies: lead with the market study and the commission-conflict number, and present SlipBench as "these agents passed this test".*

## 19. Still to verify
1. Vault single-step purchase and authorise/void in sandbox. **Open — the last thing code cannot
   close on its own (G2); it waits on a sandbox buyer approving the permission.**
2. Channel3 offer density, grouping accuracy, credit allowance. **Density and credits done** (G1
   fails at 18.33%, G5 passes; `study/results/market-study.md`). **Grouping accuracy still open**
   (G4): the study prints 30 products for a person to check, and the price-gap heuristic found three
   suspects (D68). There is no second signal in the data to lean on — of the 44 products with two or
   more comparable offers, not one has two offers that both carry Channel3's per-offer `dimensions`,
   so size and weight cannot corroborate a grouping. It needs a person.
3. ~~Agent Ready docs in full, before claiming a gap in PayPal's stack.~~ **Done, 26–27 Oct 2026**
   (D89). Four pages read in full: the agentic-commerce services overview, the `docsai`
   agentic-commerce overview, the AI-tools getting-started page and the Agent Toolkit quickstart (all
   in Sources). Everything described is merchant-side; nothing compares a price, applies a limit or
   requires buyer approval; *"supervised and automatic shopping scenarios"* appears twice and is
   defined neither time; the only buyer-side control in PayPal's own agent material is the line
   *"After approval by user, invoke capture_order"* in one example system prompt, which nothing
   enforces. §2 now carries the claim with that evidence and its bound.
4. ~~Whether PayPal publishes any sample shopping agent worth running through the bench.~~
   **Answered: no** (26–27 Oct 2026). `github.com/paypal/agent-toolkit` is the official repository;
   it wires agent frameworks (OpenAI Agents SDK, LangChain, CrewAI, Vercel AI SDK, MCP, Bedrock) to
   Orders, Invoices, Products, Subscription plans, Shipment and Disputes. Its examples are
   seller-side — a fictional coffee store doing support, recommendations and payments — and none
   browses or compares offers. So there is nothing published to run through SlipBench, which is part
   of why §6.2's second provider never materialised: the gap is not that it was skipped.
5. Rules on multiple sponsor prizes; Devpost page changes. **Open — the entrant's to check.**
6. An operator signal when a model credential is rejected. **Open, and newly known (D92).** The
   steering adapter turns a 401 into the same `NO_ANSWER` as a slow model and keeps no reason —
   correct for a checkout, because R4a holds the purchase either way and an error can quote the
   listing. The consequence in production is that a revoked or mistyped `ANTHROPIC_API_KEY` holds
   every purchase whose price gap needed the check, silently:
   `apps/web/src/server/assembly.ts` requires the variable to be present, nothing asks whether it
   works, and there is no health route. The live suites and `pnpm bench:judge` now probe it with an
   unbilled `count_tokens` call (`checkSteeringCredential`); the deployed app does not. A doctor
   command across all three services is the fix and is deliberately not half-built: PayPal needs a
   token call and Channel3 would spend a credit.

## Sources
- PayPal Orders v2: https://developer.paypal.com/docs/api/orders/v2/
- PayPal save payment methods: https://developer.paypal.com/sdk/js/save-with-purchase/paypal
- PayPal Transaction Search: https://developer.paypal.com/api/transaction-search/v1/
- PayPal Agent Toolkit: https://github.com/paypal/agent-toolkit
- PayPal Store Sync: https://developer.paypal.com/docsai/growth/agentic-commerce/store-sync/overview
  (the old `docs.paypal.ai` host 301-redirects here as of 27 Oct 2026)
- PayPal agentic commerce services, read in full for §19.3 on 26–27 Oct 2026:
  - https://developer.paypal.com/agentic-commerce-services/about
  - https://developer.paypal.com/docsai/growth/agentic-commerce/overview
  - https://developer.paypal.com/ai-tools/get-started
  - https://developer.paypal.com/ai-tools/toolkit
- Channel3 search API: https://docs.trychannel3.com/api-reference/v1/search
- ACES: https://arxiv.org/abs/2508.02630
- Magentic Marketplace: https://arxiv.org/html/2510.25779v1
- Hackathon: https://paypalaihackathon.devpost.com/