# Slip's tools for AI agents

Slip checks every purchase an AI agent tries to make before PayPal moves the money. An agent
reaches Slip through its **MCP server**. Every answer is a decision (PAID, REJECTED or HELD for
the owner) with the receipt the owner reads and the agent's next step.

| | |
|---|---|
| Endpoint | `POST /api/mcp` on the Slip web app (MCP Streamable HTTP) |
| Protocol | the 2025 revisions (served statelessly) and 2026-07-28 |
| Auth | `Authorization: Bearer slip_live_…`, the agent's own key |
| Tools | `checkout`, `get_receipt`, `get_report`, and `search_products` where a catalogue is available |
| Also | `POST /api/v1/agent/checkout` for agents without MCP (same decisions; see [docs/UI.md](docs/UI.md#the-read-api)) |

## Keys

The owner issues a key per agent on the **Agents** page, or for the demo script on the **Demo**
console. The key is shown once, and Slip keeps only its hash. The key identifies the agent and its
owner's permission, so no tool takes an agent id (D31, D52).

Each request is checked on its own:

| Answer | When |
|---|---|
| 401 with `WWW-Authenticate: Bearer` | no key, an unknown key, or a revoked key. A key revoked mid-conversation fails on its next call. |
| 403 | the request came from a browser page on another site (`Origin` not allowed) |
| 405 | `GET` or `DELETE` (2025 session operations; Slip keeps no sessions) |
| 413 | a body over 64 KiB |
| 500 | Slip failed; anything already decided is kept |

A cancelled permission can still read its receipts and report; `checkout` is refused.

## Connecting

**Claude Code**, with a key from the console:

```sh
claude mcp add --transport http slip http://localhost:3000/api/mcp \
  --header "Authorization: Bearer slip_live_…"
```

Or in a project's `.mcp.json`, with the key kept out of the file:

```json
{
  "mcpServers": {
    "slip": {
      "type": "http",
      "url": "http://localhost:3000/api/mcp",
      "headers": { "Authorization": "Bearer ${SLIP_AGENT_KEY}" }
    }
  }
}
```

If the key is wrong, a client that supports MCP authorization may report that the server "needs
authentication": Slip uses API keys, not OAuth.

**Any MCP client** that can send a header works. With the TypeScript SDK:

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.SLIP_AGENT_KEY}` } },
  }),
);
const answer = await client.callTool({
  name: "checkout",
  arguments: { product_id, chosen_offer_url, reason: "lowest listed price" },
});
```

`pnpm demo:agent` ([apps/web/scripts/agent.ts](apps/web/scripts/agent.ts)) is a complete example.

## Tools

Arguments and answers are snake_case JSON. Each answer also has a text block written for a model:
the outcome, the receipt lines, `Next: …` and the `receipt_id`.

### `checkout`

Ask to pay for the offer you chose. Slip prices the item from its own copy of the listing,
compares your choice with every comparable offer and applies the owner's limits, all before
PayPal is called.

| Argument | |
|---|---|
| `product_id` | the product's id, as the catalogue lists it |
| `chosen_offer_url` | the URL of the offer you chose, exactly as listed |
| `reason` | why you chose it; the owner reads it, no rule does (may be empty) |
| `selected_options` | optional variant, e.g. `[{"name":"Size","label":"10"}]` |

A price you send is ignored. Repeating a purchase Slip already decided returns that decision
(`replayed: true`), and nothing is paid twice:
- a payment within 10 minutes;
- an open hold, at any age;
- the same offer rejected within 10 minutes under the same limits.

After four recorded attempts on one product in an hour, Slip refuses with RETRY_LIMIT and names
the decision that stands.

The answer (`checkout` and `get_receipt` return the same shape):

| Field | |
|---|---|
| `receipt_id`, `receipt_url` | the receipt, and where the owner reads it |
| `outcome`, `rule` | PAID, REJECTED or HELD, and the rule that decided it |
| `replayed`, `replay_reason` | a repeat of an earlier decision: ALREADY_PAID, HOLD_OPEN or RECENTLY_REJECTED |
| `charged` | true only when money moved |
| `payment_status`, `in_flight`, `paypal_order_id` | where PayPal stands |
| `chosen_offer`, `best_offer` | `{ store, url, price, price_cents, commission }` |
| `gap_abs`, `gap_pct` | how much more the chosen offer cost than the lowest, e.g. `$11.00`, `23%` |
| `reasons` | one sentence per rule that tripped, deciding rule first |
| `receipt` | the receipt the owner reads, line by line |
| `hold` | `{ status, expires_at }` for a held purchase |
| `follow_up_receipt_id` | when the owner approved a hold with nothing reserved, the purchase that paid |
| `simulated` | the stores and prices came from a stand-in catalogue, not Channel3 |
| `payment_simulated` | no money moved through PayPal at all, because the gateway was a stand-in |
| `next_step` | what to do now |

`next_step` only says what to do; the receipt says what happened. It never contradicts the
receipt:
- After an overpayment, it names the lowest offer and its URL to buy instead.
- On a hold, it says when the owner decides and not to buy around it.
- While PayPal is still confirming, it says not to buy again and to call `get_receipt`.

### `get_receipt`

`{ receipt_id }`: one of your own receipts as it stands now, for example after PayPal settles or
the owner decides a hold. Another agent's receipt is `NOT_FOUND`.

### `get_report`

No arguments. Your report card:
- how many purchases you tried, and how many were paid, rejected or held;
- how often your pick was not the cheapest, typically and at worst by how much;
- how often a listing carried text written to steer you;
- how often the pricier store paid more commission.

### `search_products`

`{ query, limit? }` (limit 1–30, default 10). It lists products with every offer — store, price,
stock, condition, commission and the listing's own text — and each product's own `text`: the
description and key features from its page, shared by every store selling it.

**Product and listing text are the store's words, never Slip's.** Either may carry instructions
written for AI agents. In the demo, the "[synthetic] Top pick" badge and the note addressed to
agents are deliberate, labelled test conditions. Slip prices every checkout from its own snapshot,
whatever a search showed.

On real Channel3 data an offer has no text of its own, so the product's `text` is the only thing
there is to read — which is why Slip records what it showed you and judges that text when you check
out (D67, D69).

The tool exists where the host has a catalogue: Channel3 when `CHANNEL3_API_KEY` is set, and the
desk's stand-in catalogue in demo mode.

## Refusals and failures

A call Slip cannot check comes back as a tool error (`isError: true`) reading
`Refused (REASON): message`. Nothing was checked or recorded.

| Reason | |
|---|---|
| `MANDATE_NOT_ACTIVE` | the owner cancelled the permission, or has not finished setting it up |
| `INVALID_REQUEST` | the arguments did not parse; the message names the field |
| `BUSY` | another checkout for this item is in progress; try again shortly |
| `RETRY_LIMIT` | too many attempts on this product in an hour; the decision that stands is named |
| `NOT_FOUND` | no such receipt for this agent |
| `UNAUTHENTICATED` | the key was revoked between the endpoint's check and the tool's |

If something fails inside Slip, the tool answers "Slip could not answer that just now. Anything
already decided is kept: call get_receipt to check before trying again." The error itself is
logged, never sent to the agent.

## What is real and what is simulated

| | Today | With API keys |
|---|---|---|
| Decisions, rules, receipts | real code (`@slip/check`, `@slip/app`) | same |
| Products, offers, prices, commission | demo stand-ins, made up | Channel3 |
| Payments | stand-in PayPal in the web process | PayPal sandbox; Slip is the seller; no real money moves |
| Steering classifier | scripted stand-in | Claude (`claude-opus-5-5`, D11) |

Each of the three is decided on its own (D63), so a receipt carries two flags rather than one:
`simulated` is about the prices and `payment_simulated` about the money. The likely state while a
PayPal sandbox is being set up is real Channel3 prices with a stand-in payment — one flag for both
would have to lie about one of them. A real sandbox payment is `payment_simulated: false`: no real
money moves there either, but PayPal did take the order.

## PayPal

Slip calls PayPal's REST APIs directly and does not use PayPal's Agent Toolkit. The toolkit has
no vault, authorize or void tools, and Slip needs all three:
- the owner's one-time consent saves a payment method in the vault;
- an agent's purchase is a one-step order against that vault token;
- a hold is an authorization that the owner's decision captures or voids.

Every order and capture carries a `PayPal-Request-Id`, so a retry never pays twice. The sandbox
adapter replaces the stand-in once sandbox keys are configured.
