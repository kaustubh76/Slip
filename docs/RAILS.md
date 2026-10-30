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
| OpenAI, ACP key concepts | roles of agent, merchant and PSP; that *"OpenAI is not the merchant of record"*; that the merchant *"runs its own payment and risk analysis, and accepts or declines the order"*; a one-time delegated payment request setting **a maximum chargeable amount and an expiry** | exact field names. Any merchant binding or usage count — the page says restrictions exist and does not enumerate them. Any explicit approval step |
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

**A delegated payment request's documented constraints are a maximum chargeable amount and an
expiry** **[VERIFIED 30 Oct 2026]**, both set from what the shopper selected in the agent's own
interface. Whether the credential is also bound to one merchant is **[UNVERIFIED]** — the page
states that restrictions exist without enumerating them, and the first compatible implementation is
a third party's product whose scoping is not restated there. The argument below needs only the
maximum, so it does not rest on the open question.

**A bound whose value is taken from the thing it bounds cannot discriminate between that thing and
its alternatives.** The maximum is the price of the offer under review. $400 that is the lowest
listed price and $400 that is listed at $260 elsewhere are the same number, and a maximum of $400
admits both. This is a statement about bounds as a category, and it is not a shortcoming of any
implementation of one: a cap is a different instrument from a comparison, and it does the job it
names.

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

| Session call | What Slip would do | What exists today |
|---|---|---|
| create | run the check against its own snapshot; return the decision, the comparison and a session id | the body of `checkout`, minus the payment |
| update | re-run the check on a changed line; supersede the prior decision | nothing |
| complete | verify the decision is still valid, then call PayPal | the tail of `checkout` |
| cancel | close the session; release anything reserved | hold decline (`/api/v1/holds/[id]`) |
| retrieve | the decision and its evidence | `GET /api/v1/receipts/{id}` |

**Names from secondary sources are tagged, and none of them is load-bearing.** The endpoint
spellings `POST /checkout_sessions`, `POST /checkout_sessions/{id}/complete` and
`.../cancel`, the field `shared_payment_token` inside a `payment` object, and the status vocabulary
come from third-party write-ups, not from a primary specification
**[UNVERIFIED: third-party write-up, 30 Oct 2026]**. G14 retires each tag by replacing it with a
primary-sourced name, correcting it, or striking it. Until then the shape is what matters and the
spelling is not, and **nothing from this section appears in the README, the submission copy or the
video**.

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

**HELD is the state worth the whole section.** A documented session lifecycle has a party that
accepts and a party that declines, and in both cases it is the merchant. There is no described state
for *the money's owner has not answered yet* — and that is the state a buyer-side check spends most
of its time in: on real catalogue data the usual outcome is a hold for missing evidence, 196 of 240
sampled products carrying a single comparable offer ([MERCHANTS.md](MERCHANTS.md) §1, the
[market study](../study/results/market-study.md), 19 Oct 2026). A protocol that cannot express it
will see it as a decline.

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
  `PaymentGateway` port (`packages/domain/src/ports/payments.ts:201`), and it releases an
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
  reconcile nets settlements per invoice, and a refund arrives as `kind: "settled"` with a
  **negative** amount — PayPal reports it as its own transaction with `transaction_status: "S"`, so
  *"the sign decides, not the status"* (`packages/paypal/src/search.ts:117`, D76). Netted against
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
| `refundCapture({ captureId, amountCents, requestId, invoiceId }, signal)` | `refunded` · `pending` · `already-refunded` · `declined` · `unknown` |
| `getRefund(refundId, signal)` | `found` · `unknown` — never `not-found`, matching `getOrder`'s deliberate choice at `map.ts` |

`GatewayEvent` gains `capture-refunded` and `refund-completed`, and `SLIP_WEBHOOK_EVENTS` gains
`PAYMENT.CAPTURE.REFUNDED` — which is what makes the subscription send it at all.

**`slipBelieves` gains a reversal case**, so a refund Slip recorded stops reading as a
disagreement. That is G11, and it needs no key.

**[UNVERIFIED]** whether a refund resource carries the capture's `custom_id` through to the webhook.
If it does not, the refund is matched by its own id, which Slip will have stored. G10 answers it.

---

## 10. Refund: the call, and every way it fails

`POST /v2/payments/captures/{id}/refund`, through the existing `PayPalApi` — one token, no retries,
no deadline of its own (`packages/paypal/src/client.ts`).

- `PayPal-Request-Id`: `derivedUuid("slip:refund:" + attemptId)`, so a retry is the same request and
  never a second refund. Same discipline as the vault setup's derived id.
- `Prefer: return=representation`, as every other call in the adapter sends.
- Body: `amount { currency_code: "USD", value }`, `invoice_id` and `custom_id` both the attempt id,
  matching `orders.ts`.

| Failure | Mapped to | What happens next |
|---|---|---|
| `CAPTURE_FULLY_REFUNDED` | `already-refunded` | resolved by lookup, never by a second call — exactly how `duplicate-invoice` is handled |
| `REFUND_AMOUNT_EXCEEDED` | `declined` | no retry; the amount was wrong, and retrying it will be wrong again |
| `PERMISSION_DENIED` | `declined` | the likeliest sandbox blocker, and the first thing G10 finds out |
| capture outside PayPal's refund window | `declined` | window length **[UNVERIFIED]**; G10 records it |
| insufficient balance | `declined` | recorded verbatim; a sandbox account can be empty |
| timeout, 5xx, unreachable | `unknown` | write-ahead `REFUNDING` already stored; the resolver retries the same request id inside the window, then calls `getRefund`. `unknown` is never success |

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
| **G10** | Does Payments v2 refund a vaulted one-step capture in the sandbox; is it idempotent under a repeated request id; and does the delivered `PAYMENT.CAPTURE.REFUNDED` carry the attempt id? | one refund succeeds or the refusal is recorded verbatim; a replayed request id returns the same refund rather than a second one; the `custom_id` answer recorded either way | **[UNVERIFIED]** — needs a key, and is downstream of G2's vaulted sandbox buyer |
| **G11** | Does a refunded capture make today's reconcile disagree? | with a capture and its matching negative settlement in one window, `slipBelieves` says the full amount while the net says zero, so the attempt is counted under `reconcile.disagreed` | **[UNVERIFIED]** — **no key needed** |
| **G12** | On data already committed, how many purchases would a correction refund have been the right answer for? | report the count, whatever it is | **[UNVERIFIED]** — no key needed |
| **G13** | Is a PayPal dispute tied to a Slip attempt by anything Slip already stores? | read the documented dispute resource and one sandbox payload; record whether `invoice_id` or `custom_id` survives onto it | **[UNVERIFIED]** |
| **G14** | Do the session endpoint, field and status names in §5 match a primary specification? | every name tagged third-party in §5 is replaced with a sourced name and date, corrected, or struck | **[UNVERIFIED]** |

Each tag above is replaced in place when its gate runs. Negative results get published as G1 and G3
were.

**G11 and G12 are the two cheapest untaken gates in the repository** — no key, no model call, no
live traffic. G11 needs only a capture and a negative settlement in one window, which the PayPal
fake already produces. Taking either is a code change, and this document is not one.

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
