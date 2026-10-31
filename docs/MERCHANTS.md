# SLIP — The merchant side: standing, and the graph that earns it

**Prepared:** 30 October 2026 · **Companion to:** [SPEC.md](SPEC.md) §2 (the honest merchant
model), [study/results/market-study.md](../study/results/market-study.md)
**Status:** built — the graph of §4 (`packages/graph`), and two of the three rules of §6, `R2B`
and `R5A`, with migration `0008`. Not built: `R8` and the owner's policy knobs, attestations and
their store, and the whole hook surface of §7. Every number owed to a gate is tagged and named in
§9.

Truth labels are [SPEC.md](SPEC.md)'s: **[VERIFIED]** checked against a source on a stated date ·
**[UNVERIFIED]** confirm by a gate · **[DECISION]** design choice · **[HYPOTHESIS]** to be
measured · **[PROHIBITED]** never claim.

---

## 1. Why this document exists

Slip checks an agent's purchase for the buyer and pays, holds or rejects. Everything merchant-side
is one string on an offer inside a jsonb blob: `Offer.domain` (`packages/domain/src/offer.ts:25`).
There is no seller table, no canonical seller id, no foreign key, no enrichment. Three things
follow — the first about what Slip is worth to a payments company, the next two defects in code
that ships today.

**Slip reads, from the merchant side, as a tax on volume.** A payments company earns on captured
volume. Slip's outcomes are PAID, HELD and REJECTED, and two of the three suppress a capture. On
real catalogue data the usual outcome is a hold for *missing evidence*, not for anything a merchant
did: of 240 sampled products, **196 — 81.67% — carry a single comparable offer**, so a checkout
against one of them is held under `R2_TOO_FEW_OFFERS` whatever the seller's conduct
([market study](../study/results/market-study.md), 19 Oct 2026). Nothing lets a merchant supply
what is missing. A buyer-side guard with no merchant-side door is, to the party that monetises
merchants, a cost centre. *(The README rounds this to "two products in three"; the study's own
table is 196 of 240, which understates nothing.)*

**And the guard is gameable from the merchant side.** §2 sets out how, in the current code. This is
the part that makes a merchant-side model necessary rather than commercially convenient: the two
holes are both in the direction where a merchant has no reason to cooperate and, today, every
reason not to.

---

## 2. What is wrong today, in the code

### 2.1 A seller can manufacture its own market [VERIFIED 30 Oct 2026, by reading]

`prepareCheck` dedupes offers by normalised URL only (`packages/check/src/comparable.ts:8`) and
counts `comparable.length` as the market (`packages/check/src/prepare.ts:134`). One seller
operating three storefront domains therefore clears `R2_TOO_FEW_OFFERS`. `pickBest`
(`packages/check/src/compute.ts:24`) then selects that seller's own cheapest listing, so the gap
against it is whatever the seller chose to make it — zero, if it lists the same price twice — and
`evaluateRules` falls through to `R7_WITHIN_LIMITS`. PAID, unattended, with a receipt that reads as
a comparison against a market.

Whether it *can* happen is settled: the three lines above are the whole of it. **Whether it has
happened is now measured, and the answer is once, mildly** — G6 below finds one comparable product
in 44 whose offers all come from one seller, and it is `cos.com` listing the same socks twice under
two URLs, not an adversarial network. Slip paid that one against a market of one; it now holds it.

The sample also carries the shapes that make a domain string an unreliable seller identity, which
is the ambiguity the graph exists to resolve rather than evidence of an attack: a storefront host
that names no store (`slt-sfcc-react-production.mobify-storefront.com`, listed beside
`jcpenney.com`), and one brand across two country domains (`garvee.ca` beside `walmart.com`).
Neither of those is one seller behind several storefronts, and this document does not say they
are.

### 2.2 Silence beats disclosure [VERIFIED 30 Oct 2026, by reading]

`hasConflict` requires both commission rates to be known and above zero
(`packages/check/src/compute.ts:53`), and Channel3 reports 0 when it has no data (D3). So a
merchant that discloses a high commission can trip `R5_COMMISSION_CONFLICT`, and a merchant that
discloses nothing cannot. Withholding one field disarms the rule.

This is worse than a gap in coverage. It is an incentive pointing the wrong way: the rule rewards
exactly the merchants it was written to catch. The study's finding — the dearer offer pays more
commission in 19 of 40 comparable cases — is measured only across merchants who happened to
report, and is therefore a floor.

### 2.3 The common case is neither

Most holds are not either attack. They are the 196 products with one comparable offer, where Slip
has nothing to compare and says so. That is correct behaviour and a dead end for everyone: the
owner gets a decision they must make by hand, the agent gets a stall, the merchant loses a sale it
did nothing wrong to lose, and the payments company loses the capture.

The mechanism in §3 is aimed at all three cases at once, which is why it is a mechanism and not a
patch.

---

## 3. The mechanism: standing for disclosure

**Merchants never buy outcomes. They buy certainty** — a hold becoming a decided purchase.
Friction is the currency, because friction is the thing Slip controls and the thing merchants want
removed. No money enters the mechanism at any point. **[DECISION]**

### 3.1 The four attestations

Each is cheap for an honest merchant to make, and expensive to lie in, because each is contradicted
by a party that is not Slip.

| Attestation | Claim | Contradicted by |
|---|---|---|
| **Price binding** | this URL is this price until this time | the next fetch |
| **Commission disclosure** | this offer pays this rate | the agent platform's own payout record |
| **Identity binding** | these domains are, or are not, one seller | the payout account behind the KYC |
| **Product identity** | this listing is this GTIN/MPN | every other seller's claim on that GTIN |

### 3.2 Why it separates — the claim this rests on

Today the commission game has a **pooling equilibrium at silence**. Disclosure can only hurt a
merchant (§2.2), so no merchant discloses, and `R5_COMMISSION_CONFLICT` cannot tell any two
merchants apart.

Give silence a cost — `R5A_COMMISSION_UNDISCLOSED` in §6 — and disclosure becomes weakly better
for a merchant with nothing to hide and strictly worse for one hiding a high rate. The two
separate, and the rule starts discriminating. That is the whole argument, and it is the difference
between a mechanism and a loyalty scheme: nobody is rewarded for participating, the non-discloser
simply stops being invisible. **[DECISION]**

### 3.3 What standing may and may not do

An attestation says a price is **known**, never that it is **fair**. Everything below follows from
that one sentence.

**It may remove a hold that existed only because something was unknown.**

- A **price binding** covering the present moment is better evidence of the price than a cached
  snapshot, so it satisfies `R1`'s freshness requirement where a refetch failed — and it holds the
  price through hold approval, so an owner approving a held purchase no longer meets
  `PRICE_CHANGED`.
- A **commission disclosure** means `R5A` does not fire. The rule simply has its answer.

**It may widen a real comparison.** Attested product identity links listings that Channel3 filed
under different product ids, so offers that exist but were never compared become comparable. This
is the repair for §2.3 and for G1 at 18.33%, and it is the one that pays a cheap merchant for being
cheap: today a merchant with the best price may sit alone under its own product id and never be
seen as the best of anything.

**It may not make Slip pay for something Slip measured as wrong.** No attestation changes
`R2A_GAP_IMPLAUSIBLE`, `R3_STEERED`, `R4_OVERPAID` or `R6_ABOVE_ORDER_CAP`. **[DECISION]**

**Considered and rejected: paying on an attested lone seller.** An earlier draft had a rule paying
a single-seller purchase when that seller was fully attested. It is wrong. Attestation establishes
that the price is what the merchant says, not that it is a reasonable price, and a sole seller with
perfect attestations is exactly the party best placed to overcharge. A single comparable offer stays
a hold. The repair for a thin market is more comparisons, not more trust. **[DECISION]**

**And the owner may demand standing.** The knobs live in `Policy`
(`packages/domain/src/policy.ts:13`), already owner-edited and versioned per change by
`policyWith`: a floor, whether a disclosed commission is required, and the grace window below. So
when standing holds a purchase, it is because *this owner* asked, not because Slip or a merchant
arranged it. That is both the defensible position and the adoption engine — enrolment is pulled by
buyer demand rather than pushed by Slip.

A seller Slip has not seen before gets a **grace window**: held once, with a receipt naming what
would settle it, rather than held indefinitely. Standing alone never rejects. **[DECISION]**

### 3.4 Stores never pay for ranking

[SPEC.md](SPEC.md) §17 states *"Stores never pay for ranking."* That line stays true verbatim, on
two counts, and both are testable:

1. **No money.** Merchants pay in disclosure. There is no fee, no tier, no placement.
2. **No reordering.** `compareOffers` and `pickBest` (`packages/check/src/compute.ts:9`) are
   untouched. `best` remains the cheapest comparable offer, chosen by price, then by the lower
   commission, then by URL (D8). Standing never enters the ordering — only whether a decision needs
   a human.

---

## 4. The graph

Pure, no I/O, shaped like `packages/check`: **`packages/graph`**.

### 4.1 Nodes and edges

**Nodes** — Seller, Storefront, ProductIdentity, Offer (snapshot-scoped), Attestation, Issuer,
Incident.

**Edges** — `operates` (Seller→Storefront), `sameSellerAs` (Storefront↔Storefront),
`instanceOf` (Offer→ProductIdentity), `sameItemAs` (ProductIdentity↔ProductIdentity),
`issued` / `attests`, `incidentOn`.

A graph is not decoration here. Both defects in §2 are statements about edges the data does not
have: §2.1 is a missing `sameSellerAs`, and §2.3 is a missing `sameItemAs`. And neither edge can be
read off the catalogue — see §8.

### 4.2 Evidence tiers

Every edge carries the evidence that justified it, and the tier decides what the edge is allowed to
do.

| Tier | Evidence | May merge sellers | Worth, attested directly | May carry standing *across* | May widen comparisons |
|---|---|---|---|---|---|
| **A — binding** | shared KYC'd payout account, via an issuer attestation | yes | VERIFIED | yes | yes |
| **B — corroborating** | signed domain-control proof + matching legal name | yes | DECLARED | no | yes |
| **C — suggestive** | shared storefront platform host, identical price *and* rate across domains, shared checkout host | no | NONE | no | no |

Two different powers sit in those last columns, and keeping them apart is what stops a network
laundering standing. What a storefront's **own** attestation is worth is one question; whether that
worth **travels** to a storefront which attested nothing is another. A signed domain-control proof
says who runs a site, not who is paid for it, so Tier B is worth something directly and carries
nothing across.

### 4.3 The invariant

> **Evidence below Tier A/B may move a decision only toward HOLD — never toward PAID, and never
> toward REJECTED.**

Tier C may lower the seller count, which holds (`R2B`). It may not widen a comparison, because a
wider comparison can reject, and a guess must not reject a purchase. It may not relax anything.
This is what lets inferred edges run in a money path at all, and it is the property the property
tests exist to defend. **[DECISION]**

It also matches what the code already decided for itself: an implausible gap is HELD rather than
REJECTED, because "the comparison is suspect, the agent's choice is not"
(`packages/check/src/rules.ts:71`, D68). Uncertainty's destination is a human, in both directions.

### 4.4 The subtlety the invariant hides

A seller collapse must never feed `best`. If collapsing a Sybil ring removed the cheapest offer,
`best` would become *dearer*, the gap *smaller*, and an `R4_OVERPAID` rejection could flip to
PAID — cheap evidence relaxing an outcome by the back door, in a step whose stated purpose is
caution.

So `best` and the gap stay computed over every comparable offer, exactly as now. The collapse
produces one new number, `comparableSellerCount`, and affects nothing else. `comparableCount` keeps
its present meaning so that stored receipts still read. This is a property test, not a comment.

### 4.5 Algorithms

- **Resolution** — union-find over Tier A/B edges, each merge recording the attestation ids that
  justified it, and reversible when one expires or is revoked. A component is a Seller.
- **Standing propagation** — along Tier A only, with a ceiling: a storefront's standing may not
  exceed what its own attestations are worth by more than one rank, so one properly rooted domain
  cannot speak for every domain behind it. An unattested storefront inside a verified network
  reaches DECLARED and stops there.
- **Ring detection** — collapse each comparable set by seller component; a set that collapses to
  one component is a single-seller market. Over time, flag sellers whose comparables are repeatedly
  only each other.
- **Decay** — an incident (a steering flag, a violated price binding) lowers standing one rank for
  a fixed window and then stops counting. A window rather than a half-life, because a receipt has
  to be able to say why it held: *"one incident, until 29 November"* is checkable by the owner and
  by the merchant, and a decayed fraction is neither. Revocation applies at once.

### 4.6 Replay

A decision must replay exactly: snapshot pinned, policy version pinned, `now` injected (D22).
Standing moves, so it is read **as-of** and pinned per attempt.

Reuse the `policies` precedent rather than inventing one: append-only, primary key
`(seller_id, version)`, an optimistic `basedOnVersion` on write, and a composite foreign key from
`attempts` mirroring `attempts_policy_fk` (`packages/db/src/schema.ts:121` and `:186`). Postgres
then enforces that a receipt names the standing version it was decided under, instead of code
remembering to.

---

## 5. The adversary model

| Attack | What it gets today | What stops it |
|---|---|---|
| One seller, three domains, all above market | clears `R2`, `best` is its own cheapest, PAID (§2.1) | Tier C collapse → `R2B` → HELD |
| Withhold the commission rate | `R5` cannot fire (§2.2) | `R5A` → HELD |
| Attest honestly on one domain, run others unattested | standing laundered across the network | propagation is Tier A only, capped at one tier above direct attestations |
| Claim a GTIN that is not the item | a cheaper different item becomes "comparable", rejecting an honest purchase | only Tier A/B may widen; `R2A` holds an implausible gap; G8 hand-checks merges |
| Bind a price, then change it | a stale price treated as fresh | the binding has a validity window; a violation is an incident and decays standing |
| Revoke an attestation after a purchase | a decision justified by evidence since withdrawn | the attempt pins the standing version and attestation ids; revocation does not rewrite history |
| Enrol, gain standing, then misbehave | a clean record masking conduct | incidents decay standing on a half-life; `R3` and `R4` were never reachable by attestation |
| Two honest sellers wrongly collapsed by Tier C | an unjust hold | identity binding — Tier A overrides the guess, which is why the tightening creates a reason to enrol |

That last row is the adoption loop, stated honestly: Slip's inference is imperfect, a merchant
carries the cost of its mistakes, and the cheapest correction available to that merchant is to tell
Slip who it is.

---

## 6. The rules

New codes, not overrides. The CHECK `attempts_outcome_matches_rule` is generated from the domain's
own `RULE_OUTCOME` map (`packages/db/src/schema.ts:46`), so one rule code maps to exactly one
outcome; a relaxation that wrote PAID while keeping `ruleCode: R2_TOO_FEW_OFFERS` would violate the
database. `ruleCodes[]` already carries every rule that matched with the deciding one first, so both
the rule that would have fired and the one that decided survive onto the receipt.

| Code | Outcome | Fires when | Where |
|---|---|---|---|
| `R2B_SINGLE_SELLER_MARKET` | HELD | the comparable offers collapse to one seller | `prepareCheck`, beside `R2` |
| `R5A_COMMISSION_UNDISCLOSED` | HELD | above the flag line, the cheaper offer's rate is known, and the chosen offer's is not | `DECISION_RULES`, after `R5` |
| `R8_SELLER_BELOW_FLOOR` | HELD | the seller is below the owner's floor, past the grace window | `DECISION_RULES`, after `R6` |

`R5A` ships narrower than "the chosen offer did not disclose", and deliberately. It fires only on
the **asymmetry** — a rate for the cheaper offer and none for the chosen one — which is exactly the
shape `hasConflict` cannot judge, and it asks only the store the money goes to to speak, since that
is where the conflict of interest sits. A silent cheaper store leaves nothing to compare against
and no transaction at stake, so it holds nothing up. The broad demand — every chosen offer must
disclose — is the owner's to make through `Policy`, and waits on that (D95).

`R2B` also holds a purchase the gap rules would have **rejected**, which is worth saying out loud.
`R4_OVERPAID` claims the item was listed cheaper *elsewhere*; inside a single-seller market it was
listed cheaper by the same seller, so the claim the rejection rests on is untrue and the owner
decides instead. That is D68's reasoning moved from the gap to the seller, and it is why the
invariant reads "only toward HOLD" rather than "only away from PAID".

All three are HELD, so `RULE_OUTCOME` gains three entries and the migration drops and re-adds
`attempts_rule_codes_valid` and `attempts_outcome_matches_rule` — exactly as
`0004_classy_timeslip.sql` and `0006_jazzy_gauntlet.sql` did for `R2A_GAP_IMPLAUSIBLE`. Rule order
decides which reason a receipt names, so the order gets its own test.

**No new code for the relaxations**, by design. A price binding satisfies the existing freshness
test; a disclosed rate means `R5A` does not fire; attested identity widens the snapshot's
comparable set. Nothing new ever maps to PAID, which is the §3.3 rule expressed in the type system:
there is no code an attestation could reach that pays.

What the receipt gains, as `CheckResult` version 3 — `comparableSellerCount`, the standing version,
and the attestation ids relied on. Per D87 the jsonb payload evolves by bumping
`CHECK_RESULT_VERSION` and adding a `case` to `parseStoredCheckResult`, with no DDL.

---

## 7. The hook surface

Nothing in Slip emits anything outward today: inbound PayPal webhooks are verified and stored, the
UI polls a change stamp (D44), and there is no outbox, bus or emitter anywhere. A merchant-side
model needs both directions, so four seams:

1. **Outbound events** — an `outbound_events` outbox with signed, at-least-once delivery:
   `decision.held`, `decision.paid`, `incident.recorded`, `standing.changed`. It rides the existing
   resolver pass, which already retries failed webhooks, rather than adding a timer, and reuses
   `derivedUuid` (`packages/app/src/keys.ts:47`) for idempotent delivery keys.
2. **Merchant tools**, beside the agent's four in `packages/mcp` — `get_standing`,
   `submit_attestation`, `preview_decision`, and **`why_held`**, which names the one attestation
   that would have settled the hold just lost. `why_held` is the adoption loop made into an API
   call.
3. **An `AttestationIssuer` port** in `packages/domain/src/ports/`, a fourth beside `OffersSource`,
   `PaymentGateway` and `SteeringClassifier`, with failures as return values and never exceptions
   (D30). A self-signed stand-in ships with it; an issuer such as PayPal drops in beside it, the
   way every other outside service already does.
4. **`@slip/ui`**, already embeddable, for a merchant console.

**Copy constraint.** Six copy tests fail CI on savings and reward language, including the literal
string `bps` (`apps/web/src/copy.test.ts:13` and five siblings). Merchant-facing text says
*standing*, *disclosed*, *attested*, and percentages. Nothing in this mechanism is a reward, and
nothing should read as one.

---

## 8. Why a payments company, and not anyone else

**The graph needs an identity root the catalogue cannot supply.** Channel3 exposes no GTIN or UPC
([SPEC.md](SPEC.md) §5) and no seller entity — only a domain string. Offer URLs all redirect
through `buy.trychannel3.com`, which is why `offerDomain` must prefer the catalogue's own `domain`
field over the URL host (`packages/check/src/locate.ts:19`). Nothing in the data binds two domains
to one seller, or two product ids to one item.

Tier C can guess at both. Only an attestation can settle either, and an attestation is only worth
its tier if the issuer knows who the merchant is. Rooting that requires a party that already KYCs
the merchant and holds the payout account the money lands in. **That party is not Slip, and it is
not the catalogue.** It is a payments company, and the role is forced by the data rather than
chosen for the pitch.

What the issuer gets:

- **Captured volume it currently loses.** A hold caused by missing evidence is volume suppressed by
  data, not by risk. G9 measures the share on the committed sample.
- **A merchant-side service** for the base it already serves, paid for in disclosure rather than
  fees, so it prices as a trust service and not a toll.
- **A dispute record.** The open question in agentic commerce is who answers when an agent buys
  wrong. The attempt already pins policy version, snapshot and rule; with standing and attestation
  ids pinned too, it is evidence — which outlasts any particular rule. What that record cannot yet
  do is **act**: Slip has no reversal of a capture of any kind, so the evidence has no procedure
  attached to it. [RAILS.md](RAILS.md) §8 is the other half, and §12 is why the procedure is not a
  dispute.
- **A platform path, later.** The order today is single-payee: no `payee`, no `platform_fees`
  (`packages/paypal/src/orders.ts:84`), because Slip is merchant of record ([SPEC.md](SPEC.md) §2).
  Attested seller identity is the precondition for ever paying a real seller directly. Noted as the
  sequel; not built, not claimed.

**[PROHIBITED]**, carried over from D89 and still binding here: saying PayPal lacks, omits or forgot
a price check. Nothing in this document is a criticism of any payments company's product. The claim
is about what Slip can see in a catalogue, and who else can see more.

---

## 9. Gates

G1–G5 are taken ([SPEC.md](SPEC.md) §10). These are G6 onward. Three of the four compute from
`study/snapshots/` with no key and no model call, reusing `topPaysMore` and the per-set `domains`
the study already collects (`study/src/measure.ts:201`) — so every number in this document
recomputes on a fresh clone, which is the standard the rest of the evidence is held to.

| Gate | Question | Bar | Status |
|---|---|---|---|
| **G6** | Do single-seller markets occur in real data? | report the count over the committed sample, whatever it is | **1 of 44 comparable products** [VERIFIED 30 Oct 2026] |
| **G7** | How much does attested product identity raise comparability from 18.33%? | measured on the same sample; publish either way | **[UNVERIFIED]** |
| **G8** | Does resolution merge anything it should not? | ≤1 wrong merge in 30 hand-checked, mirroring G4 | **[UNVERIFIED]** |
| **G9** | What share of evidence-absence holds would a fully attested merchant convert? | the volume figure; publish it even if small | **[UNVERIFIED]** |

Each tag above is replaced in place when its gate runs. Negative results get published as G1 and G3
were.

**G6 ran on 30 October 2026 and found one.** `pnpm study:report` recomputes it from
`study/snapshots/` with no key and no model call, and the run reproduces the study's own published
figures — 240 products, 44 with two or more comparable offers, 18.33% — which is the check that the
measurement is reading the same sample the rest of the report does. The one case is a duplicate
listing rather than a Sybil network, and the subdomain inference contributed nothing to finding it:
both offers are literally `cos.com`, so the collapse needed no guess at all. Say it that way. `R2B`
would have shipped on a count of zero too — it costs nothing and closes a hole that needs one
motivated seller rather than a trend — but it does not have to be argued hypothetically.

---

## 10. What this document does not claim

- **That most of it is built.** The pure graph of §4 is — tiers, resolution, the seller count and
  standing, with the §4.3 invariant and the §4.4 subtlety as property tests — and two of §6's three
  rules are, `R2B` and `R5A`, with migration `0008` (D95). The rest is not: `R8` waits on the
  owner's floor in `Policy`, no table stores an attestation, no tool in §7 serves one, and so
  nothing reads the graph's standing yet. §2's two defects are the only verified claims here, and
  they are verified by reading the current code, not by exploiting it.
- **That the attacks in §2 are a pattern.** G6 found one single-seller market in 44 comparable
  products, and it is a store listing one item twice rather than a seller running storefronts to
  fake a market. One duplicate listing is not a trend, and nothing here says a seller has set out
  to exploit either hole. The withheld-rate hole (§2.2) has no gate at all yet.
- **That attestation makes a price fair.** It makes a price *known*. §3.3 is the whole of what
  standing can do, and a sole seller with perfect attestations is still held.
- **That the graph will recover much comparability.** G7 is unmeasured. Channel3's grouping may
  already be close to right, in which case `sameItemAs` buys little and the §2.3 dead end stays
  where it is. The method is worth the same either way; the number is not assumed.
- **That any payments company wants this.** §8 argues the identity root is forced and the volume is
  real. It does not assert that the argument has been made to anyone, or accepted.
