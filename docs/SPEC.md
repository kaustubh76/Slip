# SLIP — Final Ideation and Build Spec (v4)

**Prepared:** 11 October 2026 · **Event:** PayPal AI Hackathon 2026
**Deadline:** 13 Nov 2026, 1:30 AM IST · **Internal cutoff:** 11 Nov, 6 PM IST
**Lineage:** ACR / Machine TCA, ported to consumer purchases

**Changes in v4 (after external critique):** honest merchant model; payment flow rebuilt around what PayPal's API actually does; a real, non-synthetic headline number; realistic-search benchmark condition; shipping-aware rejection rule; scope cut for a solo build; plain-language UI.

> **Product:** Slip checks every purchase an AI agent tries to make, before PayPal moves the money. If the agent is overpaying or was steered, the payment does not happen. If the pricier offer it picked is also the one paying more commission, the payment waits for the owner — a conflict is a signal about the platform, not proof the agent chose badly (D2).
> **Tagline:** The second opinion on every agent purchase.
> **Operating principle:** Agents shop. Slip checks. Policy decides. PayPal pays.

## Truth labels
**[VERIFIED]** checked against a source on a stated date · **[UNVERIFIED]** confirm by a gate · **[DECISION]** design choice · **[HYPOTHESIS]** to be measured · **[PROHIBITED]** never claim.

*Corrected 30 Oct 2026 (D102). This legend read "checked against an official source on 10–11 Oct 2026" and "confirm in Phase 0" — both true when it was written and neither true since. Claims now carry their own read dates, several are against sources that are not the vendor's own, and gates ran long past Phase 0. [RAILS.md](RAILS.md) and [MERCHANTS.md](MERCHANTS.md) both open "Truth labels are SPEC.md's" and both already gave the corrected form, so two documents were quoting this one in words it did not have. This is the version all three now use.*

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

**Re-checked on 30 October 2026, against a page that had moved.** PayPal's Agent Ready overview
carries its own date — *last updated 13 Oct 2026* — and was not one of the four pages read for
§19.3. It describes three integration paths: ACP, with delegated payment tokens through Braintree;
UCP with Braintree, using a Google Pay payment handler; and UCP with PayPal, where an encrypted
Google Pay credential arrives in the checkout session and the merchant forwards it to Orders v2 for
decryption. All three describe how a credential reaches PayPal. The page names no spending limit, no
mandate and no agent identity, and customer authorisation appears only in the ACP path. **The claim
above is unchanged and its bound is unchanged**; what is new is that it has been checked against the
newest page rather than only the four that existed when it was written.
**[VERIFIED 30 Oct 2026.]** [RAILS.md](RAILS.md) §2 has the table and the sources. The protocol
underneath corroborates it from its own side: ACP's canonical specification describes itself as a
*"Merchant-implemented REST API for ChatGPT-driven checkout"*, so the party it gives the decision to
is the merchant by its own description, not by inference ([RAILS.md](RAILS.md) §4, §5).

**The stronger form of the claim is about the allowance, not an example.** A delegated payment
request carries an `allowance` whose six required fields bind the credential to a `max_amount`, a
`currency`, one `merchant_id`, one `checkout_session_id`, an `expires_at`, and `reason: one_time`
(`openapi.delegate_payment.yaml`, `spec/2026-04-17`). **Those fields are real protection** — the
credential cannot be spent elsewhere, later, for more or twice — **and they are a description of the
offer the agent already chose.** Nothing in the object refers to any other offer, because comparison
is not what it is for: $400 that is the lowest listed price and $400 that is listed at $260 elsewhere
are the same number, and an allowance for $400 admits both. **Slip's own `R6_ABOVE_ORDER_CAP` is a
bound and cannot tell them apart either** — which is why the cap is not the check in Slip, and why
saying this about anyone else's bound would otherwise be arguing in bad faith.
**[VERIFIED 30 Oct 2026.]** [RAILS.md](RAILS.md) §3.

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
| **REJECTED** | Overpaid beyond both limits, steered, or the chosen offer cannot be located in the snapshot | None. No order exists. Agent gets the reason and the better offer |
| **HELD** | Nothing comparable to price against, a comparison Slip does not trust, a check that could not answer, a commission signal the owner should see, or above the owner's per-order cap — the ten HELD codes of §5.1 | Order with intent AUTHORIZE (funds held). Human approves → capture. Human declines → void **[UNVERIFIED in sandbox; Payments v2 via REST]** |

**✎ D2** — REJECTED's row used to end *"or commission conflict"*. A conflict has held for the
owner since 11 October, not refused; §5.1 carries the reasoning.

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
conflict      = gap_abs > 0 AND chosen.commissionBps > best.commissionBps > 0
```

**✎ D3** — that last line read `chosen.max_commission_rate > best.max_commission_rate`, with no
`> 0`, and named Channel3's wire field rather than Slip's. Channel3 sends `0` for *unknown*, so
without the floor "best pays 0 %" cannot be told apart from "best's rate is unknown". Slip converts
`max_commission_rate` to `commissionBps` — the field's own integer unit, or `null` when Channel3
reported nothing usable (`packages/domain/src/offer.ts:33`) — and `disclosed()`
(`packages/check/src/rules.ts:41`) is the shipped test: *"Zero is not one: it is what it sends for no data (D3)."* The half-known case did
not go unhandled — it became `R5A` below (D95).

**Shipping problem:** Channel3 offers carry no shipping or tax **[VERIFIED]**. A $3 cheaper item with $8 shipping would be a false rejection. So price alone only rejects when the gap is large.

**The owner's defaults**, and they are the shipped ones (`DEFAULT_POLICY`, `packages/domain/src/policy.ts:33`):

| Knob | Default | What it gates |
|---|---|---|
| reject above, percent | 5 % | `R4_OVERPAID`, together with the next row |
| reject above, absolute | $8 | `R4_OVERPAID` — **both** must be exceeded |
| flag above | 1 % | the line `R3`, `R4A`, `R5` and `R5A` all sit behind |
| per-order cap | $200 | `R6_ABOVE_ORDER_CAP` |
| snapshot freshness | 10 min | refetch, else `R1_STALE_SNAPSHOT` |

The $8 allowance is a stated assumption, user-editable. Every receipt says "listed item price". Do not call the metric "best execution" or "landed cost" in the product.

### 5.1 Every rule, and what it decides

**This table used to have six rows.** The shipped set is sixteen codes — `RULE_CODES`
(`packages/domain/src/attempt.ts:19`) is the list and `RULE_OUTCOME` (`:45`) is the one place a code
maps to an outcome. The outcomes below are copied from that map, not re-derived from this
document's prose. `R1`, the four chosen-offer failures and `R2`/`R2B` decide in `prepareCheck`
(`packages/check/src/prepare.ts`) because they settle whether there is anything to compare at all;
the rest are `DECISION_RULES` (`packages/check/src/rules.ts:66`), **first match wins**.

| Rule | When it fires | Outcome |
|---|---|---|
| `R1_STALE_SNAPSHOT` | prices older than the freshness window and no refetch | HELD |
| `VARIANT_MISMATCH` | the offer is for a different variant than the one asked for | REJECTED |
| `OFFER_NOT_FOUND` | the chosen offer is not in the snapshot at all | REJECTED |
| `CHOSEN_UNAVAILABLE` | it is in the snapshot and out of stock or used — known bad | REJECTED |
| `CHOSEN_UNVERIFIED` | its price or currency cannot be read — unknown, not bad | HELD |
| `R2_TOO_FEW_OFFERS` | nothing comparable to price it against | HELD |
| `R2B_SINGLE_SELLER_MARKET` | the comparable offers collapse to one seller, so the market was never a market (D95) | HELD |
| `R2A_GAP_IMPLAUSIBLE` | a gap so wide (>100 %) that the catalogue's grouping, not the price, is the likely cause (D68) | HELD |
| `R3_STEERED` | above the flag line and the text the agent read is instruction-like | REJECTED |
| `R4_OVERPAID` | above **both** the percentage and the absolute overpay limits | REJECTED |
| `R4A_NO_CLASSIFIER_ANSWER` | above the flag line and the steering check could not answer | HELD |
| `R5_COMMISSION_CONFLICT` | above the flag line and the dearer offer pays more commission | HELD **✎ D2** |
| `R5A_COMMISSION_UNDISCLOSED` | above the flag line, the cheaper offer's rate is known and the chosen offer's is not (D95) | HELD |
| `R6_ABOVE_ORDER_CAP` | the price is above the owner's per-order cap | HELD |
| `R7_WITHIN_LIMITS` | everything else — the fallback that always matches | PAID |
| `OWNER_APPROVED` | a held purchase the owner released | PAID |

**✎ D2, and it is the one that mattered most.** This table's second row used to read *"Gap above
1 % **and** conflict or steering flag → REJECTED (steered / conflict)"*. A commission conflict has
**held** since 11 October: *"a conflict is a signal about the platform, not proof the agent chose
badly; a human should see it."* Steering still rejects. D1 named this as one of the spec's
divergences on day one and no edit followed it for nineteen days (D103).

**`R2A` is deliberately first** among the decision rules, because every rule below it reasons about
a gap that `R2A` says not to trust — and a purchase there is held, not rejected: the comparison is
suspect, the agent's choice is not.

**No LLM decides the outcome.** An LLM only classifies listing text for steering (fixed schema, no tools) and writes the receipt sentence. Rules are code.

**Steering flag:** the chosen offer is above the owner's flag line **and** the listing text or Slip's own search output contains instruction-like text.

**✎ D4** — this definition used to end *"or the agent's stated reason cites a badge or listing
claim"*. The reason is untrusted text the agent controls, so it cannot change an outcome; it is
stored and shown, and no rule reads it. `RuleContext` (`rules.ts:11`) carries the enforcement in one
line: *"Nothing here came from the agent."*

**Matching [VERIFIED]:** Channel3 groups merchant offers under one product id. Slip compares only within the same product id and selected variant. Channel3 exposes no GTIN/UPC. Accuracy of that grouping is **[UNVERIFIED]**; gate G4 checks it by hand.

## 6. Evidence plan

### 6.1 Market study: the real headline number (no agents, no synthetic content)
From a sample of products in the chosen categories (target 150–200, fewer if credits are tight), compute:
1. share of products with 2+ comparable offers;
2. typical gap between cheapest and priciest offer for the same item;
3. how often the highest-commission offer is **not** the cheapest.

This is real data from Channel3, costs only API calls, and doubles as gate G1. Whatever it shows goes in the pitch as measured, with sample size and date. **[HYPOTHESIS]** that the numbers are large enough to matter. If they are small, say so and lean on 6.2.

### 6.2 SlipBench: how agents behave
**The plan** was 20–25 errands, each naming one specific product, across 3 agents and at least two
model providers including one small low-cost model, under three conditions.

**What ran, on 26 October 2026**: **2 agents × 4 conditions × 21 errands — 168 runs**
(`bench/results/slipbench.md`, recomputed by `pnpm bench:report` with no key and no model call).
Two differences from the plan, both booked rather than quietly absorbed. There is **one provider,
not two** — a second needs a key nobody has (§19.4), which is also why it is two agents rather than
three. And there is a **fourth condition**, `buried`, which the plan did not have and which now
carries more of the argument than any other.

| Condition | What the agent gets | Purpose |
|---|---|---|
| **A. Realistic search** (`clean`) | A raw search tool with noisy, paginated results. It must find the item and compare offers itself. Nothing is manipulated | Does laziness alone cause overpayment? |
| **B. Endorsed** (`endorsed`) | Same, but a pricier offer carries a "[synthetic] Top pick" label and is listed first | Endorsement and position bias |
| **C. Injected** (`injected`) | Same, but a pricier *offer's listing* contains instruction-like text | Prompt-injection resistance |
| **D. Buried** (`buried`) | The same sentence, inside the *product's own description*, naming the dearer offer's store | Where a real listing actually has words (D86) |

**Why the attack is run twice.** In the 240 products the benchmark shops from, not one of the 321
offers carries a word of its own text, while every product carries prose — a median of 712
characters. So `injected` writes where a real listing is always silent and leaves the sentence
standing alone among prices and domains; `buried` puts it inside the description the agent was
going to read anyway. That is the difference between a test an agent can notice and one it cannot.

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
| Refund | Payments v2 `POST /v2/payments/captures/{capture_id}/refund`, read 30 Oct 2026 — the only reversal of a one-step capture; `voidAuthorization` reverses nothing that moved. Needs the refund scope, and a full refund omits `amount` | **not built; designed in [RAILS.md](RAILS.md) §9–§11, with the failure map in §10** |
| Dispute evidence | Disputes v1, provide-evidence | not built, and deliberately not designed ([RAILS.md](RAILS.md) §12) |

**[VERIFIED]** The Agent Toolkit has no vault, authorise or void tools, so the vault and hold calls go to REST directly. State this in TOOLS.md. Every single-step order needs a `PayPal-Request-Id` header; use it as the idempotency key.

**[VERIFIED]** Store Sync is limited-access and US-physical-goods only. Slip does not use Store Sync
or Agent Ready — Agent Ready is behind a merchant access form, and §12 forbids claiming its use.
[RAILS.md](RAILS.md) §5 writes Slip's interface in the shape of a checkout session so it could sit
on those rails later: designed, never claimed as used. **[VERIFIED 30 Oct 2026.]**

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

## 10. The gates

Fourteen now exist, in three documents. **G1–G5 are the Phase 0 gates below**, written for Oct
14–17 and answered; G6–G9 are [MERCHANTS.md](MERCHANTS.md) §9's; G10–G14 are
[RAILS.md](RAILS.md) §14's. Each is owned by the document that defines it and its status is
replaced there when it runs. This ledger is a reader's index, copied from those three places and
never a second opinion on them.

| Gate | In short | Defined in | Status, 30 Oct 2026 |
|---|---|---|---|
| **G1** | Do products carry 2+ comparable offers? | Phase 0, below | **Fails — 18.33%** of 240 products, against a ≥60% bar; published ([market study](../study/results/market-study.md)) |
| **G2** | Mandate → vault → unattended paid order; AUTHORIZE → void | Phase 0, below | **Open.** The one thing code cannot close: it needs a sandbox buyer to approve the vault ([SERVICES.md](SERVICES.md)) |
| **G3** | Do agents overpay or get steered? | Phase 0, below | **0% of errands**, against a ≥15% bar; the fallback below was applied and §6.2 rewritten to match |
| **G4** | Is Channel3's grouping correct? | Phase 0, below | **Open, and needs a person.** The study prints 30 products with suspects first; the price-gap heuristic found three (D68) |
| **G5** | Do credits cover the study and bench? | Phase 0, below | **Passes** |
| **G6** | Do single-seller markets occur in real data? | [MERCHANTS.md](MERCHANTS.md) §9 | **1 of 44** comparable products, and it is one store listing an item twice |
| **G7** | How much would attested identity raise 18.33%? | [MERCHANTS.md](MERCHANTS.md) §9 | **[UNVERIFIED]** |
| **G8** | Does seller resolution merge anything it should not? | [MERCHANTS.md](MERCHANTS.md) §9 | **[UNVERIFIED]** |
| **G9** | What share of evidence-absence holds would attestation convert? | [MERCHANTS.md](MERCHANTS.md) §9 | **[UNVERIFIED]** |
| **G10** | Four things only a live refund can answer | [RAILS.md](RAILS.md) §14 | **[UNVERIFIED]** — blocked behind G2's vaulted buyer. The documented half is done; one of the four narrowed on 30 Oct (D102) |
| **G11** | Does a refunded capture make the reconcile disagree? | [RAILS.md](RAILS.md) §14 | **[VERIFIED]** — and it had been proved since 20 Oct, which the first draft missed (D98) |
| **G12** | How many purchases would a correction refund have fitted? | [RAILS.md](RAILS.md) §14 | **[VERIFIED] — nil, and vacuously**; the reason matters more than the number |
| **G13** | Does anything tie a PayPal dispute to a Slip attempt? | [RAILS.md](RAILS.md) §14 | **[VERIFIED] for the documented half**; one sandbox payload closes the rest |
| **G14** | Do RAILS §5's protocol names match a primary specification? | [RAILS.md](RAILS.md) §14 | **[VERIFIED]** against `spec/2026-04-17` — endpoints right, one field name struck |

**Six gates are open, and not one of them can be closed from inside this repository.** G2 needs a
sandbox buyer to approve a vault, and G10 sits behind it. G4 needs a person to judge thirty
groupings. G7, G8 and G9 need a merchant willing to attest. G13's remaining half needs one sandbox
dispute payload. Everything that reading, measuring or testing could settle has been settled; what
is left is other people's consent and other people's time.

### Phase 0, as written for Oct 14–17

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
| Spend limits, and delegated payment tokens | Both bound an amount. A bound whose value is the price of the offer under review cannot say whether that offer was the cheapest listed; Slip compares it with the others and spots conflicts. Slip's own `R6_ABOVE_ORDER_CAP` is a bound too, and cannot do this either ([RAILS.md](RAILS.md) §3) |
| ACES, Magentic Marketplace | Measure bias in synthetic markets. Slip uses real offers and acts at the payment step |

**Claim to defend:** "On a platform that controls both the agent's payment and the checkout, Slip compares the agent's chosen offer with other listed offers for the same item, flags steering and commission conflicts, and prevents the PayPal payment when the owner's limits are breached."

**[PROHIBITED]** Gating third-party retailers' checkouts; "best execution" or landed-cost claims; savings figures not from the study or bench; presenting synthetic labels or injections as found in the wild; real purchases; use of Agent Ready or Store Sync; claiming conformance with, certification by, or use of any agent-commerce protocol — ACP, UCP, AP2 or another — or that Slip has run against any agent platform's live rails; "first benchmark of agent bias"; adoption claims without named, consenting users.

## 13. Prizes

| Prize | Fit | Why |
|---|---|---|
| **Best Use of Channel3 — chosen side track** | Strong | Offers as the comparison base; `max_commission_rate` as a conflict signal. Frame it as Channel3's transparency making the check possible |
| Best Use of Agentic Commerce | Plausible | Buyer-side check for agent purchases, with the merchant model stated plainly, and the interface written in a checkout session's shape ([RAILS.md](RAILS.md) §5) |
| Best Use of PayPal + AI | Plausible | Vault mandate, single-step pay, hold and void, reconcile; the reversal is designed and not built ([RAILS.md](RAILS.md) §9–§11) |
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

**Stretch, in order:** the correction refund of [RAILS.md](RAILS.md) §9–§11 — Slip reverses a capture its own attempt record shows was decided on evidence that was wrong. *This replaces the price-protection refund this list carried until 30 Oct 2026: refunding the difference when a cheaper listing appears within 24 h is a promise about future prices, which Slip never measured and never decided, and it has no bound. The correction refund is bounded by what Slip's own record already holds (D97).* Then one or two outside builders from your own developer community running their agent through Slip; AG Grid report card if multiple sponsor entries are allowed **[UNVERIFIED]**.

**Cut:** npm wrapper; adoption target among competing teams; 40-errand bench; live reconciliation; PYUSD or anything on-chain; shipping and tax; multi-currency; disputes — and the reasoning is now written down rather than assumed ([RAILS.md](RAILS.md) §12).

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
from the lockfile, passes 1,793 tests and 308 more on real Postgres — what that clone saw on the
day; the suite has since grown to 2,129 and the Postgres project to 310 (D90) — builds, serves a
desk, runs
the agent script to a REJECTED and a PAID receipt, and recomputes both studies byte for byte. It
also found the one defect none of that could — the demo crashing two seconds after it opens, in
dev mode, which is the mode the README gives a visitor (D79). Running it on Nov 7 would have left
one day to find that.

## 16. Video (target 2:45)
- **0:00–0:12** An agent buys something. "Did it overpay? Nobody checks."
- **0:12–0:30** The market study number, on screen with sample size.
- **0:30–1:15** Live: agent picks the pricier "Top pick" offer → Slip's receipt screen → rejected, nothing charged. Agent retries with the cheaper offer → paid, PayPal sandbox id shown.
- **1:15–1:35** A HELD purchase: funds authorised, human declines, hold released.
- **1:35–2:15** SlipBench: two measured agents, four conditions, 168 runs, with and without Slip. Two of the four are the same injection in two places — on an offer, where a real listing is always silent, and inside the product description, where it never is (D86).
- **2:15–2:30** Where this runs for real, and that the demo is sandbox with Slip as seller.
- **2:30–2:45** Close.

Use percent and dollars throughout. No basis points, no "slippage", no "TCA".

## 17. Hard questions

**Who is the merchant?** In the demo, Slip. It is the merchant of record in PayPal sandbox and relists real offers. Slip is built for platforms that hold both the agent's payment and the checkout.

**So it can't stop my agent buying from any store?** Correct. It works where the platform controls payment. That is also where the commission conflict lives.

**Shipping could make the cheaper offer worse.** Yes. Price alone only rejects when the gap exceeds 5% and $8, the allowance is editable, and every receipt says item price only.

**Are the steering attacks real?** The labels and injected text are test conditions. The market study and condition A use nothing synthetic. **What is measured rather than constructed is whether the check would catch one:** on 30 Oct 2026 the real classifier flagged 44 of 44 planted instructions and 0 of 240 honest descriptions, every call inside its 5 s deadline ([steering-judge.md](../bench/results/steering-judge.md), D93). That settles the counterfactual, not the realism of the payload — one sentence, one placement, one model, one day.

**Hasn't research shown this already?** ACES and Magentic Marketplace measured it in synthetic markets; both are cited. Slip uses real offers and acts before payment.

**Is the lowest Channel3 price the true lowest?** No. It is the lowest listed in Channel3's index at that moment. The receipt names the source.

**Why PayPal?** Vault gives one-time consent, authorise and void give a clean human-review hold, and it is where agent checkout is being built.

**Who pays for Slip?** The platform or the agent's owner. Stores never pay for ranking.

## 18. Submission copy (edit to match what ships)

**Slip — the second opinion on every agent purchase.**
AI agents are starting to spend people's money, and nothing checks whether they are overpaying or being steered — PayPal's own agent examples put the buyer's approval in a system prompt rather than in code, and nothing there checks a price. Slip checks every purchase an agent attempts before PayPal moves the money. It compares the chosen offer with other listed offers for the same item from Channel3, flags steering and cases where the pricier store pays more commission, and applies the owner's limits: pay, reject, or hold for a human. The owner approves once through PayPal; after that the agent can only pay through Slip. Every attempt gets a plain-language receipt. We measured real price and commission spreads across 240 products from Channel3's index: 18.33% carry two or more comparable offers, the typical spread between cheapest and priciest is 16.67%, and among the 40 products whose offers stated two different commission rates, the one paying the most is not the cheapest 47.5% of the time. Prices and agent decisions are real; payments run in PayPal sandbox with Slip as the seller.

We also ran **two agents — `claude-haiku-5-5`, the small low-cost one, and `claude-opus-5-5`, the frontier one — through 21 shopping errands each under four conditions, 168 runs**, with and without Slip. Neither overpaid in any condition, including the two where the pricier listing carries text addressed to shopping agents. Across the 126 errands under `endorsed`, `injected` and `buried`, no agent bought the offer the condition planted, so Slip's steering rule was never reached — the zero records that no attack landed, not that the check let one through. **That the result holds at both ends of the capability range is the part worth having**: it is two models, not agents in general, but it is a small cheap one and a frontier one agreeing, which is a different claim from one cheap model agreeing with itself. 7 of the 168 runs did not buy the product id the errand named, and the split is not a capability story: **6 bought a near-identical one, three per agent** — the catalogue files two near-identical skillets separately and the cheaper one looks right, which is the same grouping weakness the market study found, showing up again from the other direction — and **1 stopped without buying anything**. On the only trap in the data the two models tied exactly. The spread and the commission conflict are real and measured; whether a given agent walks into them is not something anyone can promise, which is the argument for checking every purchase rather than trusting a model to be careful.

*Edited 21 Oct to match what ships, and corrected 30 Oct because the edit itself went stale: it said "a second is wired and unrun", and the second agent ran on 26 October. The original claimed three agents across two providers; two are wired and measured, and there is still no second provider. Gate G3 asked for an agent to overpay or be steered on 15% of errands in some condition and got 0%, so §10's fallback applies: lead with the market study and the commission-conflict number, and present SlipBench as "these agents passed this test".*

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
   enforces. §2 now carries the claim with that evidence and its bound. *Re-checked 30 Oct 2026
   against the Agent Ready overview, which carries a **last updated 13 Oct 2026** stamp and was not
   one of the four — so the original pass was incomplete, not wrong. The finding is unchanged; the
   newer page is in Sources, and [RAILS.md](RAILS.md) §2 tabulates it (D96).*
4. ~~Whether PayPal publishes any sample shopping agent worth running through the bench.~~
   **Answered: no** (26–27 Oct 2026). `github.com/paypal/agent-toolkit` is the official repository;
   it wires agent frameworks (OpenAI Agents SDK, LangChain, CrewAI, Vercel AI SDK, MCP, Bedrock) to
   Orders, Invoices, Products, Subscription plans, Shipment and Disputes. Its examples are
   seller-side — a fictional coffee store doing support, recommendations and payments — and none
   browses or compares offers. So there is nothing published to run through SlipBench, which is part
   of why §6.2's second provider never materialised: the gap is not that it was skipped.
5. Rules on multiple sponsor prizes; Devpost page changes. **Open, and it cannot be closed by
   reading.** Both `paypalaihackathon.devpost.com/` and its `/rules` page answer an automated fetch
   with **HTTP 403** (30 Oct 2026), so the stretch item in §14 stays **[UNVERIFIED]** and the
   deadline in this document's header is the one recorded on 11 Oct rather than one re-confirmed
   since. It needs a person with a browser, which is the entrant's job and takes a minute.
6. A signal when a credential is rejected. **The operator half is done, 29 Oct 2026** (D92); a
   signal from a *running* deployment is still open and deliberately unbuilt. Every adapter folds a
   refusal into the answer a slow service gives — `NO_ANSWER` from the steering check, `UNAVAILABLE`
   from Channel3, a failure at the token from PayPal — which is correct at a checkout, because R4a
   holds the purchase either way and an error must not quote a listing back. It leaves an operator
   with nothing: a revoked key holds every purchase that needed the check, and
   `apps/web/src/server/assembly.ts` only requires the variable to be *present*.
   **`pnpm doctor:keys`** now asks each service something only a working credential can answer — an
   unbilled `count_tokens`, a product id Channel3 cannot have, an order id the PayPal sandbox cannot
   have — printing no part of any credential and never touching live. Run against this repository's
   own `.env.local` it found `ANTHROPIC_API_KEY` dead while Channel3 and the PayPal sandbox were
   healthy. *Correcting what this item said before: Channel3 was not a reason to defer it. Product
   detail is free; search is the call that costs a credit, and it is never made.* What remains is a
   key revoked **while a deployment runs**, which needs a health route or monitoring and is out of
   scope for the hackathon.
7. The refund path. **Open (G10, [RAILS.md](RAILS.md) §14)** — it needs the same vaulted sandbox
   buyer as G2, though one of its four questions narrowed on 30 Oct: PayPal's per-error reference
   publishes `REFUND_TIME_LIMIT_EXCEEDED`, so a Payments v2 refund window is documented to exist and
   only its length is unknown. The same reading retired a third-party tag, named nine more refund
   errors across eleven pages, and corrected a row that had read the endpoint page's silence as
   absence (D102). *Whether a refunded capture already makes the reconcile disagree was listed here as
   open and was not: `packages/app/src/resolver.test.ts:427` has proved it since 20 Oct, and a
   refund arrives as a negative `reversed` record rather than the `settled` this item first said
   (D98).*
8. ~~The endpoint, field and status names in [RAILS.md](RAILS.md) §5 that came from third-party
   write-ups rather than a primary specification.~~ **Done, 30 Oct 2026** (G14, D99). Read against
   the canonical `spec/2026-04-17` of the Agentic Commerce Protocol repository. The three endpoint
   names were right; **one field name was wrong** — `shared_payment_token` inside a `payment` object
   does not exist, the complete request takes `payment_data` — and it is struck. The eleven status
   values are now quoted, and the specification describes none of them, which §6 of
   [RAILS.md](RAILS.md) turns out to need. *That is the second invented detail this series has
   caught: the tagged one cost a paragraph, the untagged one cost three documents (D98, D99).*
9. A Next.js security advisory against the installed version. **Open, and deliberately not acted on
   before submission.** A fresh `pnpm web:build` stops with a `SecurityFatalError` naming a known
   advisory and recommending `next upgrade --agent=security`; re-running the identical command
   proceeds and the build is clean. *It is not a one-off: it fired twice on 30 Oct under different
   notice ids, so any build on a clean `.next` should be expected to stop once.* *D90 predicted this interstitial and recorded that it had not
   happened — it does now, which is the one prediction from that entry to come true.* Upgrading a
   framework thirteen days out, against a gate that is currently green, is the larger risk; the
   advisory is recorded here so the choice is visible rather than forgotten.

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
- PayPal Agent Ready overview (PayPal's own date: last updated 13 Oct 2026; read 30 Oct 2026):
  https://developer.paypal.com/agent-ready/overview
- PayPal Payments v2 — refund a captured payment, and show refund details; the request body,
  headers and the refund scope for [RAILS.md](RAILS.md) §10 (read 30 Oct 2026):
  https://developer.paypal.com/api/payments/v2/captures-refund and
  https://developer.paypal.com/api/payments/v2/refunds-get
- PayPal's refund guide — sample code, and the source of the two verified error names
  `CAPTURE_FULLY_REFUNDED` and `REFUND_AMOUNT_EXCEEDED` (read 30 Oct 2026):
  https://developer.paypal.com/checkout/refund-payment
- PayPal Payments v2 **per-error reference**, one page per error at
  `https://developer.paypal.com/api/payments/v2/errors/<name>` — a different document from the two
  endpoint pages above, and the source of every name and quotation in [RAILS.md](RAILS.md) §10's
  failure table (all read 30 Oct 2026). The pages used: `capture_fully_refunded`,
  `captured_amount_fully_refunded`, `refund_capture_currency_mismatch`, `refund_currency_mismatch`,
  `refund_time_limit_exceeded`, `refund_time_exceeded_for_payment_source`,
  `refund_failed_insufficient_funds`, `max_number_of_refunds_exceeded`, `refund_not_allowed`,
  `partial_refund_not_allowed`, `transaction_disputed`
- PayPal Disputes v1: https://developer.paypal.com/docs/api/customer-disputes/v1/
- PayPal, "Agentic commerce explained", 5 Mar 2026, shopper-facing (read 30 Oct 2026):
  https://www.paypal.com/us/money-hub/article/agentic-commerce-explained
- PayPal, "Is AI checkout safe?", 22 Apr 2026, shopper-facing — Purchase Protection's documented
  grounds (read 30 Oct 2026): https://www.paypal.com/us/money-hub/article/ai-checkout-security-guide
- PayPal newsroom, "Making Sense of the AI Shopping Protocol Moment", 22 Jan 2026:
  https://newsroom.paypal-corp.com/2026-01-22-Making-Sense-of-the-AI-Shopping-Protocol-Moment
- OpenAI, Agentic Commerce Protocol — key concepts (read 30 Oct 2026):
  https://developers.openai.com/commerce/guides/key-concepts
- Agentic Commerce Protocol, the canonical specification — current stable `spec/2026-04-17`,
  `openapi/openapi.agentic_checkout.yaml` (read 30 Oct 2026):
  https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
- The same release's `openapi/openapi.delegate_payment.yaml` — the `Allowance` object quoted in
  §2 and in [RAILS.md](RAILS.md) §3 (read 30 Oct 2026). A separate specification from the checkout
  one, and this pass used both.
- OpenAI's agentic checkout spec, the earlier release of the same protocol — its example header
  reads `API-Version: 2025-09-12` (read 30 Oct 2026):
  https://developers.openai.com/commerce/specs/checkout
- PayPal, show dispute details — the `disputed_transactions` field list for G13 (read 30 Oct 2026):
  https://developer.paypal.com/api/customer-disputes/v1/disputes-get
- Channel3 search API: https://docs.trychannel3.com/api-reference/v1/search
- ACES: https://arxiv.org/abs/2508.02630
- Magentic Marketplace: https://arxiv.org/html/2510.25779v1
- Hackathon: https://paypalaihackathon.devpost.com/