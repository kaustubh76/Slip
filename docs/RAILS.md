# SLIP — The rails side: a decision in a checkout session's shape, and the reversal it owes

**Prepared:** 30 October 2026 · **Companion to:** [SPEC.md](SPEC.md) §2 (where Slip runs), §7
(PayPal usage), §12 (positioning) · [MERCHANTS.md](MERCHANTS.md) §8 (the dispute record)
**Status:** designed, nothing built. No code changes accompany this document. §5–§7 specify an
interface Slip does not expose; §9–§11 specify a PayPal call Slip does not make. Every number owed
to a gate is tagged and named in §14.

Truth labels are [SPEC.md](SPEC.md)'s: **[VERIFIED]** checked against a source on a stated date ·
**[UNVERIFIED]** confirm by a gate · **[DECISION]** design choice · **[HYPOTHESIS]** to be
measured · **[PROHIBITED]** never claim.

---

## 1. Why this document exists

Three things happened, and only the first is about anyone else's product.

**PayPal's published description of its agentic rails was updated after this repository last read
it.** [SPEC.md](SPEC.md) §2 carries the claim the whole pitch rests on, verified on 26–27 Oct 2026
against four pages (D89). The Agent Ready overview carries its own date — *last updated 13 Oct
2026* — and was not one of the four. It was read on 30 Oct 2026, and §2 below is what it says. The
finding in §2 of the spec is unchanged and its bound is unchanged; what is new is that it is now
checked against the newest page rather than only the pages that existed when it was written. That
re-check is the point, not the result.

**The claim it rests on can be anchored on a mechanism rather than on an example.** The spec's
version turns on a line in an example system prompt. §3 states it instead as a property of a bound,
which is checkable, which survives a documentation rewrite, and which — stated honestly — indicts
one of Slip's own rules in the same breath.

**And Slip can stop a payment but cannot undo one.** That is a defect in code that ships today, not
a gap in anyone's documentation. §8 has the four readings that establish it. It matters more than
the first two, because a gate that can only ever say no is a filter, not a policy engine: Slip
claims the authority to decide a payment, and an authority that cannot correct itself is not one.

---

## 2. What the public pages describe, on 30 October 2026

All five were read on 30 Oct 2026. Where a page carries its own date, both are given.

| Source | What it names | What it does not |
|---|---|---|
| Agent Ready overview (*last updated 13 Oct 2026*) | three integration paths: **ACP** with delegated payment tokens through Braintree (ChatGPT, OpenAI); **UCP with Braintree** via the Google Pay payment handler (Google AI Mode, Gemini); **UCP with PayPal**, where an encrypted Google Pay credential arrives in the checkout session and the merchant forwards it to **Orders v2** for decryption. Names `/api/orders/v2` | no headers, no request fields. No spending limit, no mandate, no agent identity. Customer authorisation appears in the ACP path only |
| Agentic commerce services overview | Agent Ready and Store Sync; that Agent Ready *"supports both supervised and automatic shopping scenarios"* | no API, no endpoint. Nothing on buyer approval, spending controls, agent authentication, or who verifies that a purchase matches what the shopper wanted |
| OpenAI, ACP key concepts | roles of agent, merchant and PSP; that *"OpenAI is not the merchant of record"*; that the merchant *"runs its own payment and risk analysis, and accepts or declines the order"*; a one-time delegated payment request setting **a maximum chargeable amount and an expiry** | exact field names. Any merchant binding or usage count — the page says restrictions exist and does not enumerate them, though **the OpenAPI does, and §3 quotes it**. Any explicit approval step |
| PayPal, *Agentic commerce explained* (5 Mar 2026, shopper-facing) | that providers **may** offer *"spending limits or requiring a final 'yes' before a purchase"*; human-in-the-loop as the assistant stopping to ask permission; *"approving a final price"* | which providers do. Buyer protection |
| PayPal, *Is AI checkout safe?* (22 Apr 2026, shopper-facing) | that Purchase Protection *"covers eligible items purchased through various online channels"* including AI shopping assistants, *"if an item doesn't arrive or match the seller's description"*; *"Terms and limitations apply"* | exclusions, which sit in the linked terms |

**All three Agent Ready paths describe how a credential reaches PayPal.** That is what an
acceptance product is for, and the observation is about scope, not about quality.

**The bound from D89 applies unchanged, and one line of it is load-bearing here.**
*"Supervised"* and *"automatic"* appear on PayPal pages and are defined on neither. So what sets a
bound in an automatic scenario is **not described** on any page read on 30 Oct 2026, and this
document does not infer that nothing does. **[UNVERIFIED]**, and it stays that way until a page
defines the term.

**[PROHIBITED]**, carried from D89 and still binding: saying PayPal lacks, omits or forgot a price
check. Nothing in this document is a criticism of any payments company's product. Purchase
Protection does what the page above says it does.

---

## 3. The cap and the comparison

**A delegated payment request carries an `allowance`, and the specification publishes it in full.**
`POST /agentic_commerce/delegate_payment`, in `spec/2026-04-17/openapi/openapi.delegate_payment.yaml`
of the repository named in §5. The `Allowance` object has six properties and **every one is
required** — **[VERIFIED 30 Oct 2026]**:

| Property | What it binds |
|---|---|
| `max_amount` | how much, as an integer in **minor units** — the same discipline as Slip's own integer cents |
| `currency` | which currency, `^[a-z]{3}$`, ISO-4217 **lowercase** where PayPal's Orders v2 takes `"USD"` uppercase — a real seam for anyone mapping between the two |
| `merchant_id` | *"Unique identifier for the merchant authorized to use this token"* |
| `checkout_session_id` | which session |
| `expires_at` | until when |
| `reason` | an enum admitting only `one_time`, *"currently only one_time is supported"* |

There is **no usage or transaction count** anywhere in the object; `reason` is the only usage
control. *An earlier draft of this section had merchant binding as `[UNVERIFIED]` while the
specification that answers it sat unread in the same repository as the checkout spec (D101).*

**What the allowance protects, which this document owed it.** Those six fields stop a credential
being spent somewhere else, later, for more, twice, or against a different session. That is real
protection, and it is the kind that matters most when a credential is handed to software: it bounds
the blast radius of the credential itself. Every earlier wording here went past that on the way to
the sentence below, and understating another party's product is the same failure as overstating this
one.

**And none of it is a comparison.** The allowance is a *description of the offer the agent already
chose* — how much, in what currency, to which merchant, for which session, until when. Nothing in
it refers to any other offer, because comparison is not what it is for. **It bounds what may be done
with the credential; it says nothing about whether the purchase was a good one.** Binding a
credential harder to one particular choice cannot make that choice a better one.

**Concretely.** `max_amount` is the price of the offer under review. $400 that is the lowest listed
price and $400 that is listed at $260 elsewhere are the same number, and a `max_amount` of $400
admits both — correctly, in both cases, because the allowance was asked whether the credential may
be spent and not whether it should be. A cap is a different instrument from a comparison, and it
does the job it names.

**Slip has a bound of its own, and it cannot do this either.** `R6_ABOVE_ORDER_CAP`
(`packages/domain/src/attempt.ts:33`) holds a purchase above the owner's maximum order size, and it
is blind in exactly the same way — it would pass the $400 overpayment as readily as the $400 best
price. That is why the cap is not the check in Slip either, and why the comparison is a separate
rule set. A document that made this a criticism of someone else's bound while shipping its own
would be arguing in bad faith.

**None of this is a new claim.** [SPEC.md](SPEC.md) §12 has carried the row *"Spend limits · Cap
amount. Slip compares price with the market and spots conflicts"* since v4, written before any of
the pages in §2 existed in their current form. What this section adds is a current, specific,
dated artefact for the general claim to be about. The thesis was not reverse-engineered from the
rails; the rails arrived and matched it.

---

## 4. The step the protocol already reserves

**ACP's documented roles are agent, merchant and PSP, and the merchant is the party that
decides.** It *"runs its own payment and risk analysis, and accepts or declines the order"*
**[VERIFIED 30 Oct 2026]**. So the lifecycle already contains a point at which a policy runs
against an assembled order and may refuse it. What it does not describe is a policy that runs there
on the *buyer's* behalf, answerable to the person whose money it is.

**Slip is that policy, and in the sandbox it occupies the merchant's seat literally.**
[SPEC.md](SPEC.md) §2 is unambiguous: Slip is merchant of record, its sandbox app is the seller, and
no order reaches a retailer. So Slip is not claiming a fourth role in anybody's protocol. It runs a
buyer-side policy at the point the protocol gives the merchant, because in this deployment it *is*
the merchant — and in a deployment where it is not, the same check has to be invited in by whoever
is. §5 writes the interface so that invitation is a small one.

**[DECISION]** The placement is the design claim. Everything downstream of it is shape.

---

## 5. Slip's interface in a checkout session's shape

**Slip today is complete-only.** `POST /api/v1/agent/checkout` and the MCP `checkout` tool check
and pay in a single call ([TOOLS.md](../TOOLS.md)); there is no session object anywhere in the
codebase, and nothing an agent can hold open, revise and then settle. A documented session
lifecycle is create → update → complete → cancel, so the mapping below is a split of one call into
four, not new behaviour.

| Spec operation | What Slip would do | What exists today |
|---|---|---|
| `POST /checkout_sessions` | run the check against its own snapshot; return the decision, the comparison and a session id | the body of `checkout`, minus the payment |
| `POST /checkout_sessions/{checkout_session_id}` | re-run the check on a changed line; supersede the prior decision | nothing |
| `POST …/complete` | verify the decision is still valid, then call PayPal | the tail of `checkout` |
| `POST …/cancel` | close the session; release anything reserved | hold decline (`/api/v1/holds/[id]`) |
| `GET /checkout_sessions/{checkout_session_id}` | the decision and its evidence | `GET /api/v1/receipts/{id}` |

**The names above are now read from the specification, and one earlier guess was wrong.** This
section first carried endpoint and field names from third-party write-ups, tagged as such. The
canonical source is `agentic-commerce-protocol/agentic-commerce-protocol`, whose current stable
release is **`spec/2026-04-17`**: `openapi/openapi.agentic_checkout.yaml`, `openapi: 3.1.0`,
`version: 2026-04-17`, titled *"Agentic Checkout API"* and described as a
*"Merchant-implemented REST API for ChatGPT-driven checkout."* OpenAI's own published checkout spec
is the earlier release — its example header reads `API-Version: 2025-09-12` — so the repository and
not that page is the primary source. **[VERIFIED 30 Oct 2026.]**

- **The three endpoint names were right.** `POST /checkout_sessions`, `.../complete` and
  `.../cancel` all appear verbatim. Two corrections of detail: an update is a **`POST` to the
  session's own path**, not a PATCH, and a retrieval is a `GET` on that same path.
- **`shared_payment_token` inside a `payment` object does not exist, and is struck.** The complete
  request takes **`payment_data`**, required. The spec's `PaymentData` schema carries `handler_id`,
  `instrument` and `billing_address`, with the credential at `instrument.credential.token`; its own
  examples show flatter shapes — `{token, provider}` in one, `{type: vault_token, token}` in
  another. The indirection arrived with the payment handlers of `spec/2026-01-30`. **The divergence
  between that schema and those examples is recorded, not resolved** — nothing here needs it
  settled, and guessing which wins is how the struck name got in. One detail does narrow it: the
  delegate-payment response of §3 returns its `id` as a **vault-token** identifier, `vt_…`, which is
  the shape the flatter `{type: vault_token, token: vt_…}` example uses. So the two specifications
  cohere on that prefix — which is **not** the same as knowing which shape `complete` requires,
  since the schema still says `instrument.credential.token`.
- **The spec's own version example is stale, which is why this section carries two dates.** The
  checkout API's `info.version` is `2026-04-17` and its `API-Version` header example reads
  `2025-09-12`; the delegate-payment API's version is also `2026-04-17` with an example reading
  `2025-09-29`. A specification whose examples lag its version is a specification to quote with a
  read date.
- **The status vocabulary is eleven values**: `incomplete`, `not_ready_for_payment`,
  `requires_escalation`, `authentication_required`, `ready_for_payment`, `pending_approval`,
  `complete_in_progress`, `completed`, `canceled`, `in_progress`, `expired`. **The spec describes
  none of them.** The only description belongs to the property — *"Current status of the checkout
  session"* — and no enum value carries one. §6 is what that absence turns out to be worth.

**Reading a specification is not conforming to one.** Nothing above says Slip implements this, is
certified against it, or has run on any platform's rails; §12 of [SPEC.md](SPEC.md) forbids each of
those and §15 restates it. The standing rule also holds: **nothing from this section appears in the
README, the submission copy or the video.**

**[DECISION]** Specified, not exposed. Slip's surface is the four MCP tools, and adding a fifth
shape before anything asks for it would be the worst kind of speculative interface.

---

## 6. The three outcomes as session states

Slip's outcomes already are session states; they have simply never been addressed as such.

| Outcome | Session state | What the agent may do | Where the owner comes in |
|---|---|---|---|
| PAID | may be completed | complete, once, with the decided amount | afterwards, on the receipt |
| REJECTED | declined | read the rule code and the better offer; nothing else | afterwards, if they want to change a limit |
| HELD | awaiting a decision that is not the agent's | wait, or cancel | **approve or decline**, inside `DEFAULT_HOLD_TTL_MS` — 48 h (`packages/domain/src/hold.ts:17`) |

**HELD is the state worth the whole section, and the specification reserves a slot for it without
filling it in.** Among the eleven statuses of §5 is **`pending_approval`** — alongside
`authentication_required` and `requires_escalation` — so an answer that has not arrived yet is a
state the protocol expects. What it does not say is **whose** approval, what unblocks it, or how
long it may wait, because it describes no status value at all. *An earlier draft of this document
claimed there was no such state; there is, and the slot being named and empty is the better fact
(D99).*

**Slip's HELD is that slot with the parties written in**: the owner's approval and nobody else's,
an explicit approve or decline rather than a timeout, forty-eight hours of it
(`packages/domain/src/hold.ts:17`), and a receipt naming the rule that put it there. That is the
state a buyer-side check spends most of its time in: on real catalogue data the usual outcome is a
hold for missing evidence, 196 of 240 sampled products carrying a single comparable offer
([MERCHANTS.md](MERCHANTS.md) §1, the [market study](../study/results/market-study.md),
19 Oct 2026). A protocol that names the state without describing it leaves every implementer to
decide what it means; this is what one answer looks like.

**Time of check is not time of use, and the split creates the gap.** One call could not have this
problem; four can. **[DECISION]** a decision is valid only as long as the snapshot it was made from
is fresh — the same bound `R1` already enforces — and a `complete` arriving after that re-runs the
check rather than honouring the stale verdict. A verdict is not a coupon.

**`complete` carries the decided amount, and a mismatch is a refusal.** The repository already has
this discipline and the name for it: hold approval previews an amount and then approves against it
(`/api/v1/holds/[id]/preview`, then `approve`). The session case reuses it verbatim. An amount that
does not match what was decided never reaches PayPal.

---

## 7. The delegated token, and what Slip may do with it

**One invariant.** The token's maximum is an upper bound Slip must respect, and never evidence Slip
may cite.

- **Respect it.** If the decided amount exceeds the maximum, refuse before calling PayPal. A
  payment attempt certain to be refused downstream is a worse answer than a refusal with a reason.
- **Never cite it.** The maximum never enters `best`, never enters the gap, and never appears on a
  receipt as a fact about whether a price was good. Its value came from the chosen offer, so using
  it as evidence about the chosen offer is circular — which is §3's argument, applied to Slip
  before it is applied to anyone.

**[DECISION]** The invariant is one line of code and the reason is the whole document.

---

## 8. The reversal Slip owes

**Slip can stop a payment and cannot undo one.** Four readings of the current code, all
**[VERIFIED 30 Oct 2026, by reading]**:

- **There is no refund call anywhere.** `voidAuthorization` is the only money-reversal call in the
  `PaymentGateway` port (`packages/domain/src/ports/payments.ts:206`), and it releases an
  authorisation that never moved money. A one-step capture — which is what the PAID path creates —
  has no reversal in Slip at all.
- **A refunded capture reads as captured, correctly.** `CAPTURE_HELD` includes `REFUNDED` and
  `PARTIALLY_REFUNDED` (`packages/paypal/src/map.ts:64`), because *"the money moved, and a refund
  is outside what Slip models — calling it anything else would say the charge never happened."*
  That line is right and §9 does not change it.
- **A refund is never delivered, not merely unhandled.** `pnpm paypal:webhook` subscribes to
  exactly `SLIP_WEBHOOK_EVENTS` intersected with what the app is offered
  (`apps/web/scripts/paypal-webhook.ts:47`), and `PAYMENT.CAPTURE.REFUNDED` is not in that list
  (`packages/paypal/src/webhooks.ts:101`), whose own comment says *"a subscription narrower than
  this loses money events silently."* The `default` arm at `:160` then names the three real events
  with no rule — *"a refund, a dispute, an order approval"* — but it never has to run for a refund,
  because the delivery never arrives.
- **So a refund issued out of band reads as the owner's own account disagreeing with Slip.** The
  reconcile nets settlements per invoice. PayPal files a refund as its own transaction with
  `transaction_status: "S"` — the same status as a payment, with a **negative** amount — and `"V"`
  carries reversals and chargebacks, so **the sign decides and not the status**; the mapper turns a
  negative `"S"` into `kind: "reversed"` (`packages/paypal/src/search.ts:151`, D76). Which of the
  two labels it lands on changes nothing here, because `netByInvoice` adds `settled` and `reversed`
  in one branch (`packages/app/src/resolver.ts:178`). Netted against
  the capture it gives zero, while `slipBelieves` returns the full amount for any `CAPTURED` payment
  and has no reversal case (`packages/app/src/resolver.ts:192`). The attempt is therefore counted
  under `reconcile.disagreed` and raises the mandate's unmatched count — the figure the permission
  slip shows the owner — on every pass for as long as the window reaches back, three days by default
  (`reconcileWindowMs`, `packages/app/src/config.ts:42`). Not forever: it falls out of the window,
  which is worse, because it stops without being resolved.

**The plumbing to see a refund was built. The destination was not.** The port comment says `kind`
keeps settlements and reversals apart *"because a reconcile that collapsed the two … could not see
a refund at all"* (`packages/domain/src/ports/payments.ts:63`), and D76 worked out that the sign
decides. Slip can already observe a refund in full detail and has nowhere to put it.

**And the kill switch is prospective only.** `revokeMandate` revokes, declines open holds, releases
their reservations and deletes the saved method at PayPal (`packages/app/src/mandates.ts:316`).
From that moment nothing more can be charged. Nothing already charged is touched. An owner who
discovers a bad purchase can only prevent the next one.

**Why this is an obligation and not a feature.** Slip has a *measured* way of deciding wrongly.
Channel3's grouping accuracy is **[UNVERIFIED]** and G4 is still open; the study's price-gap
heuristic turned up three suspect groupings in the committed sample and there is no second signal in
the data to settle them, so it needs a person ([SPEC.md](SPEC.md) §19.2, D68). A purchase decided on
a grouping that was wrong is a PAID decision resting on a comparison the project has itself
published as unreliable. Today there is nothing to be done about one.

---

## 9. Refund: what it costs the model

**Considered and rejected: a `REFUNDED` payment status.** `CAPTURED` is terminal — its transition
list is empty — and the payment graph is deliberately acyclic. A refund that could be declined
would have to return a payment from `REFUNDED` to `CAPTURED`, which is the first cycle in the
machine and would make every exhaustive proof over it weaker. The status set stays as it is.

**[DECISION] A reversal is its own record, with its own small machine**, hanging off the payment
rather than replacing its status:

```
NONE → REFUNDING → REFUNDED
                 → REFUND_DECLINED
```

What that leaves untouched, which is the point: `Payment`, `TERMINAL_PAYMENT_STATUSES`,
`IN_FLIGHT_PAYMENT_STATUSES`, the partial unique index on the payments table, and
`missingPaymentFields`. It also matches how PayPal models it — a refund is its own resource under a
capture, not a new state of one.

`PAYMENT_OPERATION_KINDS` gains `REFUND`, so the request-id audit stays in one place and a refund is
idempotent by the same mechanism as a capture and a void.

**Port additions** to `PaymentGateway` (`packages/domain/src/ports/payments.ts`), in the house's
three-outcome style, never throwing:

| Method | Result vocabulary |
|---|---|
| `refundCapture({ captureId, requestId, invoiceId, reason }, signal)` | `refunded` · `pending` · `already-refunded` · `declined` · `unknown` |
| `getRefund(refundId, signal)` | `found` · `unknown` — never `not-found`, matching `getOrder`'s deliberate choice at `map.ts` |

**No `amountCents` on the input, deliberately.** A correction refund returns the whole capture,
because Slip captures once and in full — `CaptureAuthorizationInput.finalCapture` is the literal
`true`. PayPal's refund body makes `amount` optional and takes its omission to mean a full refund
(§10), so the smaller surface is also the documented one, and a partial refund is a later decision
rather than a parameter nobody sets. It also puts three documented failures out of reach rather
than one — `REFUND_AMOUNT_EXCEEDED`, `PARTIAL_REFUND_NOT_ALLOWED` and `TRANSACTION_DISPUTED` are
all partial-refund failures (§10) — and one full refund per capture is what keeps
`MAX_NUMBER_OF_REFUNDS_EXCEEDED` unreachable too. `reason` carries the trigger from §11 into
PayPal's own `note_to_payer`.

`GatewayEvent` gains `capture-refunded` and `refund-completed`, and `SLIP_WEBHOOK_EVENTS` gains
`PAYMENT.CAPTURE.REFUNDED` — which is what makes the subscription send it at all.

**`slipBelieves` gains a reversal case**, so a refund Slip recorded stops reading as a
disagreement. That is G11, and it needs no key.

**The tie to an attempt was never an inheritance question, which an earlier draft of this section
had wrong.** The refund request accepts `invoice_id` and `custom_id` of its own (§10), so Slip sets
them rather than hoping PayPal copies the capture's — and `custom_id` is documented as the field
*"used for reconciliation"*, which is the one §8 needs. **[VERIFIED 30 Oct 2026]** against the
reference. Two things stay open and both belong to G10: whether the **delivered webhook** carries
either id, and a discrepancy between PayPal's own two pages — the refund-create response example
shows `custom_id`, the refund-lookup example shows `invoice_id` and not `custom_id`. **So the design
keys on the refund id Slip stored, with `invoice_id` as the corroborating field**, and never on
`custom_id` alone; one sandbox payload settles which of the two examples is right.

---

## 10. Refund: the call, and every way it fails

`POST /v2/payments/captures/{capture_id}/refund`, through the existing `PayPalApi` — one token, no
retries, no deadline of its own (`packages/paypal/src/client.ts`). Lookup is
`GET /v2/payments/refunds/{refund_id}`. **[VERIFIED 30 Oct 2026]** against PayPal's reference; this
section was written from it rather than around it, after an earlier draft invented one of the error
names below (D100). *Read a second time the same day against PayPal's **per-error** reference,
which the first reading never opened: it retired one tag, corrected one row and added five names
(D102). The endpoint page and the error directory are two different documents, and this section
needed both.*

- **Authorisation** is the ordinary client-credentials token, but the reference states the call needs
  the **refund scope**. An app without it fails here and nowhere earlier, which is the honest form of
  what this section used to call its likeliest sandbox blocker.
- `PayPal-Request-Id`: `derivedUuid("slip:refund:" + attemptId)`, so a retry is the same request and
  never a second refund. Same discipline as the vault setup's derived id, and the header is
  documented as the idempotency key.
- `Prefer: return=representation`, **because `return=minimal` is the default** and returns only
  `id`, `status` and links — not enough to record what was returned.
- **Body, with `amount` left out.** Every field is optional and omitting `amount` *is* how the
  reference spells a full refund, which is the only kind §9 asks for. What is sent: `invoice_id` and
  `custom_id`, both the attempt id, matching `orders.ts`, with `custom_id` documented as the field
  *"used for reconciliation"*; and `note_to_payer`, at most 255 characters, carrying §11's trigger.
  That last one *"appears in the payer's transaction history and emails"* — so the reason a purchase
  was corrected reaches the owner where they already look, not only on a Slip receipt.
- **Worth storing from the response**: `id` as the refund id the resolver looks up, `status`, and
  `seller_payable_breakdown.total_refunded_amount` — the figure any second attempt would have to
  reconcile against.

| Failure | Mapped to | What happens next |
|---|---|---|
| `CAPTURE_FULLY_REFUNDED` — *"The capture has already been fully refunded."* · `CAPTURED_AMOUNT_FULLY_REFUNDED` — *"The captured amount has already been fully refunded."* | `already-refunded` | resolved by lookup, never by a second call — exactly how `duplicate-invoice` is handled. **Two names and two pages, one condition** |
| the refund scope absent from the app | `declined` | fails at the call, not at the token; the first thing G10 finds out. The one row here that is not an error name, because a missing scope is a property of the app |
| `REFUND_CAPTURE_CURRENCY_MISMATCH` · `REFUND_CURRENCY_MISMATCH` — *"Refund must be in the same currency as the capture."* | `declined` | Slip is USD-only by constraint, so this is the shape a currency slip would take. Two names again, with the same message on both pages |
| `REFUND_TIME_LIMIT_EXCEEDED` — *"You are over the time limit to perform a refund on this capture."* | `declined` | the capture is too old for PayPal. **A v2 window exists; its length is [UNVERIFIED]** — no page read states it, and G10 records it from a live refusal — below |
| `REFUND_TIME_EXCEEDED_FOR_PAYMENT_SOURCE` — *"Refund was refused by the payment source."* | `declined`, and it reaches the owner | a second clock, belonging to the payer's instrument rather than to the capture — below |
| `REFUND_FAILED_INSUFFICIENT_FUNDS` — *"Refund cannot be processed due to insufficient funds."* | `declined` | recorded verbatim; a sandbox account can be empty |
| `MAX_NUMBER_OF_REFUNDS_EXCEEDED` — *"You have exceeded the number of refunds that can be processed per capture."* | `declined` | §9 issues one full refund per capture and never a second, so Slip should not be able to reach it |
| `REFUND_NOT_ALLOWED` — *"Capture cannot be refunded."* | `declined` | the catch-all; the reference names no condition for it, so it is recorded and not interpreted |
| timeout, 5xx, unreachable | `unknown` | write-ahead `REFUNDING` already stored; the resolver retries the same request id inside the window, then calls `getRefund`. `unknown` is never success |

Every name and every quotation in that table is from PayPal's **per-error reference**, one page per
error at `developer.paypal.com/api/payments/v2/errors/<name>` — **[VERIFIED 30 Oct 2026]**.

**The correction that reading cost, and it is the useful kind.** This table used to carry a row
reading *"180 days is the documented figure for the legacy `RefundTransaction` and for Braintree,
not for Payments v2, whose reference states no limit."* The provenance half of that is still right
and still worth saying — 180 days belongs to two other products and must not be carried over. The
rest took the endpoint reference's silence for absence. `REFUND_TIME_LIMIT_EXCEEDED` is published,
so **Payments v2 documents that a limit exists**; what no page read on 30 Oct 2026 states is **how
long it is**. That is a smaller question than the one G10 was carrying, and a better one.

**The second clock is the owner's problem, not the resolver's.**
`REFUND_TIME_EXCEEDED_FOR_PAYMENT_SOURCE` is *"The time limit set by the payer's selected payment
source to refund this transaction has expired"*, and PayPal's own instruction is to *"Contact the
payer directly to arrange a refund via alternative means."* Two things follow. It is a clock Slip
cannot see, belonging to an instrument Slip never chose — the vaulted wallet's funding source. And
it is the one failure in this table with **no automated remedy at all**: retrying cannot help, the
window will not reopen, and the correction §8 owes has to be completed by a person. So it is the
one row that must surface to the owner as something to act on rather than as a line in a record.

**The failure names belong in a list, because Slip already keeps them that way.**
`packages/paypal/src/orders.ts:55` and `:68` hold `ORDER_DECLINED` and `VOID_REFUSED` — named
arrays of PayPal issue codes, one per condition — and `said()` (`client.ts:184`) matches any of
them against `details[].issue` or the error's own name. The two-names-one-condition case is not new
either: `orders.ts:118` already reads `said(answer, "DUPLICATE_INVOICE_ID", "INVALID_INVOICE_ID")`.
So the refund path specifies as a `REFUND_DECLINED` list in that same shape, with both names of
each doubled condition in it. **What a missed name would actually cost**, stated exactly: the
branch falls through to `{ kind: "unknown" }` (`orders.ts:126`), never to success, so an
unrecognised refusal becomes a retry on the same request id and then a `getRefund` lookup. The cost
is a wasted round trip and a less precise record — not money reported returned that never returned.

**`REFUND_AMOUNT_EXCEEDED` is not in that table, and naming it is still the point — only now there
are three.** Omitting `amount` is what makes a refund full, and it puts `REFUND_AMOUNT_EXCEEDED`
(PayPal's refund guide handles it beside `CAPTURE_FULLY_REFUNDED`), `PARTIAL_REFUND_NOT_ALLOWED`
and `TRANSACTION_DISPUTED` all out of reach, because every one of them is a partial-refund failure.
The reference says so itself: `PARTIAL_REFUND_NOT_ALLOWED`'s own resolution is *"Specify an amount
equal to the capture amount or omit the `amount` object from the request."* That is PayPal
documenting this section's design choice as the way out of an error — which is a better source for
it than this document's own reasoning, and the reason §9 keeps partial refunds out is three
failures wide rather than one.

**The write-ahead comes first, always.** `REFUNDING` is stored before the call, the same way the
payment row is written before `createOrder`. Money reported returned that never returned is the one
failure this design must not have.

---

## 11. Who may ask, and who may never

**The agent may never.** No tool asks for a reversal and none returns one. An agent that can both
spend and un-spend can probe the owner's limits for nothing — buy, observe the verdict, undo — and
the agent is the party under check. This is a documented absence, not an unimplemented feature, and
[TOOLS.md](../TOOLS.md) says so in writing.

**The owner may**, from a receipt, for any reason or none.

**Slip may, on a closed and enumerated list** — which is what keeps this from becoming a promise:

1. A grouping Slip itself later establishes was wrong, so the comparison the decision rested on was
   not a comparison of the same item (the G4 case, §8).
2. A decision taken on a snapshot that is afterwards shown to have been stale or malformed.
3. A capture taken against a mandate that was revoked before the decision — a race the resolver can
   detect and today can only report.
4. A re-check inside a stated window finding that the chosen offer was not the cheapest comparable
   one **at the time of the decision**, on evidence Slip holds.

**Trigger 4 is narrower than it looks, and deliberately.** It is about the decision, not about the
market afterwards. *"Refund the difference if a cheaper listing appears within 24 h"* — the form
[SPEC.md](SPEC.md) §14 carried as stretch scope until 30 Oct 2026 — is a promise about future
prices, which Slip never measured, never decided, and cannot bound. A listing can appear at any
price at any time. The correction refund is bounded by what Slip's own record already holds, which
is the only thing it can actually defend (D97).

**Who bears the cost in a real deployment is not decided here.** It is the platform's commercial
question. In the sandbox Slip is merchant of record and so refunds itself, which decides nothing
about anybody else's economics, and this document does not pretend otherwise.

---

## 12. Disputes, designed out

[MERCHANTS.md](MERCHANTS.md) §8 argues that Slip's attempt record — policy version, snapshot, rule
codes, and since D87 the exact listing text the classifier read — *"is evidence"*, and that the open
question in agentic commerce is who answers when an agent buys wrong. That argument stands. The
integration does not follow from it, for four reasons:

- **Slip is the respondent, not the raiser.** As merchant of record it is the party a dispute is
  filed *against*. Providing evidence is a seller-side act, and the buyer-side record is not what
  that endpoint is for.
- **Purchase Protection's documented grounds do not include this case, and that is not a gap in
  it.** It covers an item that *"doesn't arrive or match the seller's description"* (§2). On an
  overpayment the seller performed: the item arrives, it matches, and the price was one the buyer's
  own agent agreed to. A dispute process adjudicates the seller's performance, and there was nothing
  wrong with it. The thing that went wrong happened on the buyer's side, before the money moved,
  which is where Slip sits and where no dispute process is meant to reach.
- **[SPEC.md](SPEC.md) §14 cuts disputes**, and nothing here is a reason to reopen a cut made for
  scope.
- **It cannot be exercised.** The evidence payload is multipart file upload and the sandbox flow
  cannot be driven before 12 Nov.

**The one fact that would reopen it** is whether a dispute resource carries anything that ties it to
a Slip attempt — a capture's `invoice_id` or `custom_id` surviving onto it. That is G13, and it is a
reading task, not a build.

**A dispute does reach §8's reversal, in one direction only.** An open case on a capture blocks a
refund for less than the remaining amount — `TRANSACTION_DISPUTED`, *"Partial refunds cannot be
offered at this time because there is an open case on this transaction"* (§10). Slip never issues
one, so the correction of §9 is not blocked by a dispute it knows nothing about. That is a
consequence of a choice made for other reasons, not an argument for integrating here.

**There is a narrow bridge, named and not built.** D87 stores `searchContext`: the exact text the
steering classifier read, as the agent read it. Where a listing's words moved an agent *and* the
item does not match those words, that is the one ground a dispute does cover, with machine-captured
evidence of what was read and when. Worth recording. Not worth building two weeks out.

---

## 13. The adversary model

| Attack | What it gets today | What stops it |
|---|---|---|
| An agent asks for a refund to probe the owner's limits for free | nothing — no path exists | no agent-facing reversal, by design (§11), written into [TOOLS.md](../TOOLS.md) |
| A refund request replayed | two reversals | `PayPal-Request-Id` derived from the attempt; PayPal's own `already-refunded` resolved by lookup, never by a second call (§10) |
| A refund issued in the PayPal dashboard, out of band | the reconcile reports the owner's own account as disagreeing, every pass for three days, then stops without resolving **[VERIFIED 30 Oct 2026, by reading]** | subscribe `PAYMENT.CAPTURE.REFUNDED`; record a reversal Slip did not initiate; net it in `slipBelieves` (§9) |
| A session completed carrying a token whose maximum exceeds the decided amount | Slip prices from its own snapshot, so nothing — but nothing checks it either | the decided amount must match; a mismatch is a refusal before PayPal is called (§6) |
| A session completed after its decision went stale | a payment at a price nobody decided | validity bounded by snapshot freshness; `complete` past it re-runs the check (§6) |
| The token's maximum cited in a receipt as evidence of a fair price | a circular receipt | §7's invariant: the maximum never enters `best`, the gap or a receipt line |
| A seller drops a price after capture to trigger a refund it can then contest | unbounded liability and a claim Slip cannot defend | trigger 4 is about the decision, not the market afterwards; nothing fires on a price that moved later (§11) |
| A refund declined, state left half-written | money reported returned that never returned | write-ahead `REFUNDING`; `unknown` is never success; the resolver finishes with the same request id (§10) |

---

## 14. Gates

G1–G5 are taken ([SPEC.md](SPEC.md) §10); G6–G9 are [MERCHANTS.md](MERCHANTS.md) §9's. These are
G10 onward.

| Gate | Question | Bar | Status |
|---|---|---|---|
| **G10** | Four things only a sandbox charge can answer: does the app have the **refund scope**; does a replayed `PayPal-Request-Id` return the same refund rather than a second one; does the delivered `PAYMENT.CAPTURE.REFUNDED` carry the attempt id; and **how long** is the v2 refund window? *That its existence is documented is now settled — `REFUND_TIME_LIMIT_EXCEEDED` is published (§10, D102) — so only the length is left, which is the narrower question.* | one refund succeeds or the refusal is recorded verbatim, and each of the four is written down either way | **[UNVERIFIED]** — needs a key, and is downstream of G2's vaulted sandbox buyer. The documented half of this gate is done (§10); what is left is only what a live call can show |
| **G11** | Does a refunded capture make today's reconcile disagree? | with a capture and its matching negative settlement in one window, `slipBelieves` says the full amount while the net says zero, so the attempt is counted under `reconcile.disagreed` | **[VERIFIED 30 Oct 2026]** — and it was already proved on 20 Oct; see below |
| **G12** | On data already committed, how many purchases would a correction refund have been the right answer for? | report the count, whatever it is | **[VERIFIED 30 Oct 2026] — nil, and vacuously**; see below |
| **G13** | Is a PayPal dispute tied to a Slip attempt by anything Slip already stores? | read the documented dispute resource and one sandbox payload; record whether `invoice_id` or `custom_id` survives onto it | **[VERIFIED 30 Oct 2026] for the documented half**; the payload half is open — see below |
| **G14** | Do the session endpoint, field and status names in §5 match a primary specification? | every name tagged third-party in §5 is replaced with a sourced name and date, corrected, or struck | **[VERIFIED 30 Oct 2026]** against `spec/2026-04-17` — endpoints right, one field name struck |

Each tag above is replaced in place when its gate runs. Negative results get published as G1 and G3
were.

**G13 closes on its structural half and stops there.** PayPal's *Show dispute details* reference
lists each entry of `disputed_transactions` as carrying `buyer_transaction_id`,
`seller_transaction_id`, `reference_id`, **`invoice_number`** and **`custom`**, beside
`create_time`, `transaction_status`, `gross_amount`, `gross_asset`, `buyer`, `seller`, `items` and
`payment_processor`. Slip sets both `invoice_id` and `custom_id` on every order to the attempt id
(`packages/paypal/src/orders.ts`), so a dispute has somewhere for a Slip attempt to survive, and a
list can be filtered by `disputed_transaction_id`. **What the reading cannot settle** is whether
PayPal fills those two fields from the capture's own, and which of them any given caller is shown —
the reference publishes the names with placeholder values and no descriptions, and warns that *"the
fields that appear in the response depend on the access."* One sandbox payload answers both, which
is the half of this gate's bar that stays open. It does not reopen §12: a tie that exists is not a
reason to build a dispute integration.

**G10 is the only one of the five that reading cannot close.** It needs a charge against a vaulted
wallet, which needs the sandbox buyer that has blocked G2 since the beginning — the one step in
this project nothing can automate ([SERVICES.md](SERVICES.md), "The one manual step").

**G11 was closed ten days before it was written.**
`packages/app/src/resolver.test.ts:427` — *"a refund Slip never recorded is a disagreement too"*,
added 20 Oct 2026 with the D76 work — drives the whole chain through `runResolver`: a completed
capture, a same-invoice negative `reversed` record, both past the fake's three-hour reporting lag
and inside the window, ending in `reconcileUnmatched === 1`. This document originally called the
gate untaken, which was a failure to look (D98). What the test genuinely did not assert was the
step in the middle — that `reconcile.disagreed` fires, with the full amount against zero — and
repository-wide that event was asserted nowhere, so the `=== 1` was equally consistent with a
different mismatch. It now asserts both, and it is the first assertion anywhere on that event.

**G12 cannot be measured from committed data, and the reason is worth more than the number.** The
suspect population and the held population are the same set, by construction: the study's
`SUSPECT_GAP_PCT_HUNDREDTHS` is `IMPLAUSIBLE_GAP_PCT_HUNDREDTHS`, so every mis-grouping the data
can flag is one `R2A_GAP_IMPLAUSIBLE` **holds** rather than pays — with a property test asserting
that nothing above the line is ever PAID (D68). A purchase paid on a wrong grouping therefore needs
a gap *below* 100%, and the price-gap heuristic is blind to those by construction. Beyond that, no
committed purchase touches a suspect — the widest gap among the benchmark's 21 errand products is
89.47%, so `R2A` never fires there at all — and the runs do not serialise their own outcome or rule
code, which are recomputed at report time. So the honest answer is **nil, as a count of the
absence of evidence rather than of the absence of the phenomenon**. The instrument that would
settle it is G4, which needs a person, and the market study's *"Grouping, for a person to check"*
table now prints the product id and lists the suspected groupings first, because two of the three
fell outside its first thirty rows ([market study](../study/results/market-study.md)).

---

## 15. What this document does not claim

- **That any of it is built.** Nothing is. §5–§7 specify an interface Slip does not expose, and
  §9–§11 a call Slip does not make. The only verified claims are §2's reading of five public
  pages and §8's four readings of the current code — and §8's are verified by reading it, not by
  running it.
- **That Slip conforms to, is certified by, or has run on any agent-commerce protocol's rails.** It
  has not, and the endpoint and field names in §5 are tagged third-party precisely so that nothing
  downstream can quietly start depending on them. Agent Ready stays unused and
  [SPEC.md](SPEC.md) §12's prohibition stands.
- **That a cap is a defect.** It is a different instrument, doing the job it names, and §3 indicts
  Slip's own `R6_ABOVE_ORDER_CAP` on identical grounds. Nothing here says a payments company's
  product is missing anything.
- **That a refund is a price promise.** §11's trigger list is closed and is about decisions Slip can
  show were wrong on evidence it already holds. It is not price protection, and the unbounded form
  was removed from the spec rather than renamed.
- **That anyone has asked for this.** §4 argues the placement is available and §8 that the
  obligation is real. Neither asserts that the argument has been made to anyone, or accepted.
