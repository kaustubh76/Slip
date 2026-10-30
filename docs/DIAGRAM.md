# The diagram, box by box

[`diagram.png`](diagram.png) is the execution flow, and [D1](DECISIONS.md) makes it the
authority: where it and [`SPEC.md`](SPEC.md) disagree, the code follows the diagram. This file is
the other direction — every numbered box against the code that implements it and a test that
proves it, so that "the product matches the diagram" is something a reader can check in an
afternoon rather than take on trust.

Departures are not left to be noticed. Each is marked **✎** and carries the decision that booked
it; the pattern is D2–D4, and the ones found by the 23 October scan are in
[D82](DECISIONS.md#d82--2026-10-23--the-diagram-read-back-against-the-code).

Paths are from the repository root. "Scenario Sn" means
[`tests/src/spec-scenarios.test.ts`](../tests/src/spec-scenarios.test.ts).

## 1 · MANDATE

| Box | Code | Proof |
|---|---|---|
| M1 Set the limits | `packages/domain/src/policy.ts` (`DEFAULT_POLICY`), `apps/web/src/views/LimitsView.tsx`; every edit is a new version | `packages/app/src/mandates.test.ts`, `apps/web/src/lib/limits-example.test.ts` |
| M2–M5 The approval | **✎ D82** — the header note's no-purchase alternative is what shipped: `POST /v3/vault/setup-tokens` → owner approves → `POST /v3/vault/payment-tokens`, in `packages/paypal/src/vault.ts`. No order is created and no `store_in_vault` exists | `packages/paypal/src/__contract__/gateway-contract.ts`, `packages/app/src/mandates.test.ts`, `apps/web/e2e/owner-start.spec.ts` |
| M5 `APPROVED` → wait for the webhook | `vault.ts` returns `pending` when PayPal has not named the token; finished by `VAULT.PAYMENT-TOKEN.CREATED` (`packages/app/src/webhooks.ts`) or `pollSetup` (`mandates.ts`) | `packages/app/src/webhooks.test.ts` |
| M6 Store the mandate | `packages/app/src/mandates.ts` (`startMandate`, `completeMandateSetup`); the vault id is encrypted at rest | `packages/app/src/mandates.test.ts`, `packages/db/src/__contract__/` |

## 2 · CHECK

| Box | Code | Proof |
|---|---|---|
| 1 Shop | `packages/offers/src/search.ts`; the agent's tool is `search_products` in `packages/mcp/src/server.ts`, logged per (agent, product) by `apps/web/src/server/search.ts` so the classifier reads what the agent saw (D69) | `apps/web/src/server/search.test.ts`, `tests/src/mcp.test.ts` |
| 2 Ask Slip to pay | `packages/mcp/src/server.ts` (`checkout`), and `POST /api/v1/agent/checkout` for agents without MCP | `tests/src/mcp.test.ts`, `apps/web/src/server/agent-api.test.ts` |
| 3 Gatekeeping | `packages/app/src/checkout/gate.ts` — schema, key → agent → mandate, the lease on (agent, product), the replay of a recent decision, the retry cap | `packages/app/src/checkout/gate.test.ts`, scenarios S13, S14 |
| 4 Get the offers | `packages/app/src/checkout/decision.ts` (`currentSnapshot`, 5 s deadline); no fresh snapshot → R1 | scenario S10 |
| 5 Offer data | `packages/offers/src/channel3.ts` — `GET /v1/products/{id}`, `x-api-key`, USD, `selected_options`; 402/5xx/timeout → no data | `packages/offers/src/channel3.test.ts`, `packages/offers/src/live.test.ts` |
| 6 Save the snapshot | the store's `snapshots`; every decision points at the snapshot it used, and the benchmark replays them rather than calling out | `packages/db/src/__contract__/`, `bench/` |
| 7 Filter and locate | `packages/check/src/comparable.ts`, `locate.ts`, `variant.ts`, `url.ts`; the price always comes from the snapshot | `packages/check/src/locate.test.ts`, scenarios S7, S8, S14 |
| 8 Compute | `packages/check/src/compute.ts` — integer cents, no network, no model | `packages/check/src/boundaries.test.ts`, scenario S15 |
| 9 Steering classifier | `packages/steering/src/claude.ts` + `prompt.ts`; runs only above a 1 % gap, no tools, fixed output, 5 s to "no answer" | `packages/steering/src/claude.test.ts`, `live.test.ts`, scenarios S5, S5b |
| 10 Apply rules R1–R7 | `packages/check/src/rules.ts` + `decide.ts`; the attempt, check result and decision are written in one transaction, before any PayPal call | `packages/check/src/scenarios.test.ts`, `rules.property.test.ts`, all of S1–S15 |
| retry cap | `maxAttemptsPerRetryWindow` in `packages/app/src/config.ts` — four attempts on one product in an hour, which is the drawing's "3 retries" | `packages/app/src/checkout/gate.test.ts` |

## 3A · PAID

| Box | Code | Proof |
|---|---|---|
| P1 Write-ahead record | `packages/domain/src/records.ts` — INITIATED with the ORDER request id, amount from the snapshot, written before PayPal is called | `packages/app/src/checkout/checkout.test.ts`, scenario S11 |
| P2 Pay in one step | `packages/paypal/src/orders.ts` — `POST /v2/checkout/orders`, `intent: CAPTURE`, `payment_source.paypal.vault_id`, `stored_credential.payment_initiator: MERCHANT`, `invoice_id` **and** `custom_id` = attempt id, `PayPal-Request-Id` | `packages/paypal/src/__contract__/gateway-contract.ts`, `packages/paypal/src/live.test.ts` (needs a vaulted buyer) |
| P3 Handle the response | `packages/app/src/payments.ts` (15 s deadline), `outcomes.ts` (the status map); a timeout or 5xx is UNKNOWN, never a second order | scenarios S11, S12 |
| P4 Write the receipt | append-only; the sentence's numbers are filled in by code, never by a model (`packages/receipt/src/`) | `packages/receipt/src/*.test.ts` |
| P5 Result to the agent | `apps/web/src/server/agent-api.ts`, and `get_receipt` over MCP | `apps/web/src/server/agent-api.test.ts` |
| P6 Fulfilment | **not in the demo**, and the diagram says so: Slip is the seller and no order reaches a retailer | the disclosure band, `apps/web/src/server/disclosure.test.ts` |

## 3B · REJECTED

| Box | Code | Proof |
|---|---|---|
| X1 No PayPal call | the decision is written and the branch ends; nothing is created or held | scenario S2 |
| X2 Write the receipt | the reason, the best listed offer, and both commission rates worded "pays up to X%" | `packages/receipt/src/sentences.test.ts`, `packages/ui/src/copy.test.ts` |
| X3 Result to the agent | as P5 | `apps/web/src/server/agent-api.test.ts` |
| X4 Retry or stop | the gate's retry cap and its replay of a recent rejection | `packages/app/src/checkout/gate.test.ts` |

## 3C · HELD

| Box | Code | Proof |
|---|---|---|
| H1 Hold the funds | `packages/paypal/src/orders.ts` — `intent: AUTHORIZE` with the vault id, reading `purchase_units[0].payments.authorizations[0].id` (`map.ts`). No price to hold → a hold with no PayPal order. **✎ D82**: the drawing's "valid for 29 days" is not tracked; expiry is read from PayPal's own `AUTHORIZATION_EXPIRED` | `packages/paypal/src/__contract__/gateway-contract.ts`, scenario S10 |
| H2 Record the hold | `packages/app/src/checkout/decision.ts` stamps `expiresAt` from `holdTtlMs` (48 h) | `packages/app/src/holds.test.ts` |
| H3 Approval screen | `apps/web/src/views/HoldsView.tsx` + `components/HoldDecision.tsx`. **✎ D82**: the diagram's `POST /api/holds/{id}/approve` and `/decline` now exist as `POST /api/v1/holds/{id}/approve`, `/decline` and `/preview` (`apps/web/src/server/hold-api.ts`); since D83 a write that names another origin is refused (`apps/web/src/server/origin.ts`) | `apps/web/src/server/hold-api.test.ts`, `origin.test.ts`, `owner-route.test.ts`, `apps/web/e2e/money.spec.ts` |
| H4a Approve → capture | `POST /v2/payments/authorizations/{id}/capture` (`orders.ts`) | scenario S9, `apps/web/e2e/money.spec.ts` |
| H4b Decline → void | `POST /v2/payments/authorizations/{id}/void`; a voided hold can never be captured | scenario S9 |
| H5 Close the hold | `packages/app/src/holds.ts` (`closeHold`); a failed capture is FAILED and shown, nothing charged | `packages/app/src/holds.test.ts` |
| H6 Hold guards | `packages/domain/src/records.ts` — only AUTHORIZED moves, and only once; a repeat reports where things stand and starts nothing. Auto-void at 48 h is the resolver's `expireHolds`. A hold with no order pays by follow-up after a re-check (`approveByFollowUp`) | `packages/app/src/holds.test.ts`, `resolver.test.ts`, `apps/web/e2e/money.spec.ts` |

## 4 · AFTERWARDS

| Box | Code | Proof |
|---|---|---|
| A1 Agent report card | `packages/app/src/report-view.ts`, `packages/ui/src/components/ReportCard.tsx`, and `get_report` over MCP | `packages/app/src/report-view.test.ts`, `packages/ui/src/components/kit.test.tsx` |
| A2 Daily reconcile | `packages/app/src/resolver.ts` (`reconcile`) — matched on `invoice_id`/`custom_field`, window ends a reporting lag ago, stamped as an "as of" (D75, D76). **✎ D82**: the owner's count is amounts that disagree; a record Slip cannot tie to an attempt has no permission to be filed under and is logged | `packages/app/src/resolver.test.ts` |
| A3 Resolver job | `packages/app/src/resolver.ts`; every 30 s in a long-lived process, every 5 min on a schedule (`apps/web/vercel.json`). **✎ D82**: the UNKNOWN re-send window is 30 minutes, not the drawing's 6 hours — D34's ladder, because a charge must not execute long after a decision made on a ten-minute snapshot | `packages/app/src/resolver.test.ts`, scenario S12 |
| A4 Review and change limits | `apps/web/src/views/LimitsView.tsx`; an edit makes a new policy version and past decisions keep theirs | `apps/web/src/lib/limits-example.test.ts`, `packages/app/src/mandates.test.ts` |
| A5 Revoke (kill switch) | `packages/app/src/mandates.ts` — the mandate is revoked **before** `DELETE /v3/vault/payment-tokens/{id}`, so a crash cannot leave money able to move (D36); `VAULT.PAYMENT-TOKEN.DELETED` lands on the same shutdown | `packages/app/src/mandates.test.ts`, `webhooks.test.ts`, `apps/web/e2e/money.spec.ts` |

## The panels

| Panel | Where it lives |
|---|---|
| RULES R1–R7 (+ R4a) | `packages/check/src/rules.ts`; `RULE_OUTCOME` is the single rule→outcome map, and the database CHECK is generated from it rather than hand-listed | `packages/db/src/__contract__/sql-guards.ts` |
| WHEN THINGS BREAK | each line is a scenario or a resolver task; the timeouts are `packages/app/src/config.ts` (Channel3 5 s, classifier 5 s, PayPal 15 s), tied together by a guard that keeps the lease longer than all three |
| ALWAYS TRUE | the agent never holds credentials (keys are hashed), no model decides an outcome (D4), prices come from the snapshot, the decision is written before money moves, one PayPal order per attempt |
| PAYMENT STATUS | `packages/domain/src/payment.ts` — the ten words and the legal moves between them |
| INTERFACES | MCP tools in `packages/mcp/src/server.ts`; the owner's read API and the three hold writes in `docs/UI.md`. **✎ D82**: `get_order` and `list_transactions` are direct REST, not PayPal's Agent Toolkit, which has no vault, authorize or void tools |

## Still open

The diagram's own `NOT YET RUN — TEST FIRST` panel listed five things. Two are answered: Channel3's
offer URLs do **not** survive between calls (D70), and the market study measured comparable-offer
density at 18.33 % with D68 on the grouping. The other three — paying with a vault id in one step,
AUTHORIZE then void, and whether `stored_credential` is needed — are `pnpm test:live:paypal`,
which skips until `PAYPAL_TEST_VAULT_ID` exists. That needs a sandbox buyer's wallet vaulted
through the approval flow, which is the one step in the whole diagram that no code can take.
