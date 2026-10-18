# Slip's owner UI

The owner's side of Slip: receipts, holds, limits, agents, the permission slip and its kill
switch. It is built as two layers so that a platform can embed Slip's receipts in its own app:

- **`@slip/ui`**, a React kit with no Next.js imports: the theme, the stationery components, a
  typed client for the read API, and hooks over TanStack Query.
- **`apps/web`**, the Next.js 16 app that hosts the kit: pages, server actions, the read API, the
  agent endpoint, sessions and demo mode.

Everything the kit draws comes from `ReceiptView` JSON made by `@slip/receipt`, the one renderer
of receipt copy. The kit never sees a domain record. Design choices are logged in
[DECISIONS.md](DECISIONS.md) from D38 on.

## The look: Till Roll

The UI is made of slips. Receipts print on a roll, the mandate is a permission slip, each agent
has a report card, and outcomes are rubber stamps that differ in shape as well as colour: PAID is
a solid outline, REJECTED a double one, HELD a dashed one. Three inks on one paper: black for
what Slip printed, stamp colours only for verdicts, and pen-blue for anything the owner did.

### Themes and tokens

All colours, fonts, radii and timings are CSS custom properties in
`@slip/ui/tokens.css`. No other stylesheet writes a colour literal; a test enforces it, and
another checks WCAG AA contrast for every text colour against the paper in both themes.

| Token | Role |
|---|---|
| `--slip-desk`, `--slip-paper` | page background; every slip, form and dialog |
| `--slip-edge` | hairlines and perforations, never text |
| `--slip-ink`, `--slip-ink-faint` | body text; captions and meta |
| `--slip-ink-ghost` | dotted leaders and rules only |
| `--slip-pen` | the owner's hand: links, decisions, focus ring |
| `--slip-stamp-{paid,rejected,held}` and `-wash` | verdict stamps |
| `--slip-stamp-void` | REVOKED, EXPIRED, VOIDED, NOT RUN YET (never red) |
| `--slip-font-sans`, `--slip-font-mono` | IBM Plex Sans for sentences, Plex Mono for what the machine printed |
| `--slip-radius-control`, `--slip-radius-stamp` | 2px and 4px; slips are square |
| `--slip-motion-{print,reveal,stamp,press}` | 0 under reduced motion |
| `--slip-slip-max`, `--slip-target` | slip width; minimum touch target |

Two themes: **Original** (light) and **Carbon** (dark). `data-slip-theme="original|carbon"` on
`<html>` selects one, and without it the system preference decides. The choice is stored in the
`slip-theme` cookie, so the server renders the right theme on the first paint.
`data-slip-contrast="more"` (or `prefers-contrast: more`) turns faint ink to full ink.

The masthead has a **More contrast** switch that sets the attribute and remembers it in the
`slip-contrast` cookie.

Use `components.css` with the tokens, or restyle the kit by overriding the variables. Both files
use cascade layers (`slip.tokens`, `slip.components`), so a host's own styles win without
`!important`.

### Hooks for styling and tests

Slip roots carry data attributes a host can style or select on:

| Attribute | On | Values |
|---|---|---|
| `data-slip-outcome` | receipt rows and slips | `PAID`, `REJECTED`, `HELD` |
| `data-slip-rule` | receipt slips | the deciding rule code, e.g. `R4_OVERPAID` |
| `data-slip-payment` | receipt slips | the state line's payment status: `NONE`, `INITIATED`, `AUTHORIZED`, `CAPTURED`, `FAILED`, … |
| `data-slip-hold` | receipt slips | `NONE`, `PENDING`, `APPROVED`, `DECLINED`, `EXPIRED` |

Components that link take a `Link` prop (`LinkLike`), so a host passes its router's link.
Without one they render a plain `<a>`.

### Keyboard

`useShortcuts(enabled, onAction)` turns keys into actions. The host decides what each action does
and keeps the on/off switch, because single-key shortcuts must be possible to turn off (WCAG
2.1.4). Keys are ignored while the owner types in a field, while a dialog is open, or when a
modifier is held.

| Keys | Action |
|---|---|
| `j` `k` | next or previous receipt or hold |
| `a` `d` | open the approve or decline dialog for the hold in focus; the confirm still needs a press |
| `/` | focus the roll's agent filter |
| `g` then `r` `h` `l` `a` `b` `m` | go to Receipts, Holds, Limits, Agents, Bench, Mandate |
| `t` | switch theme |
| `?` | the help sheet, with the on/off switch |

In `apps/web`, **Keys** in the masthead opens the same sheet. Turning the shortcuts off is
remembered in that browser.

## The data layer

### Client

```ts
import { createSlipClient, SlipProvider, safeCommands } from "@slip/ui";

const client = createSlipClient({
  baseUrl: "",              // the read API's origin; "" for same-origin
  fetch,                    // optional
  commands: safeCommands({  // how money commands reach the server
    previewApproval, approveHold, declineHold,
    updateLimits, revokeMandate, issueKey, revokeKey,
  }),
});

<SlipProvider client={client} onEvent={(e) => console.log(e.moved)}>{app}</SlipProvider>
```

Every response is parsed with the zod schemas in `@slip/receipt/schema`. A 401 is a
`SlipClientError` of kind `signed-out`, a 404 is `not-found`, a 5xx is `server`, and a body that
fails its schema is `invalid`. Only server errors are retried, at most twice. Commands are
supplied by the host: in `apps/web` they are server actions. `safeCommands` turns a call that
never answered into `{ status: "unknown" }`, because a money command that got no answer may still
have done its work.

On the server, `seedSlipQueries` from `@slip/ui/server` fills a per-request query cache, and
`<SlipHydrate>` hands it to the client. A page then renders complete on the first paint, and the
hooks take over from there.

### Hooks

| Hook | Returns |
|---|---|
| `useReceipts({ agent })` | `rows` newest first, `fresh` (just printed), `newAbove` and `revealNew()` (receipts waiting behind the pill while the owner reads lower down), `loadOlder()`, `olderCursor` |
| `useReceipt(id)`, `useHolds()`, `useAgents()`, `useReport(agentId)`, `usePolicies()`, `useMandate()` | query results; each takes `{ enabled }` |
| `useHoldDecision(id)` | `loadPreview()`, `approve(expectedAmountCents)`, `decline()`, `preview`, `refusal`, `status: idle \| busy \| unknown`, `decided` |
| `useUpdateLimits()`, `useRevokeMandate()`, `useAgentKeys()` | mutations; a new API key exists only in the mutation result, never in the cache |
| `useLive({ initialToken })` | `mode: live \| offline \| signed-out`, `lastCheckAt`, `lastChangeAt` |
| `useClock(everyMs, serverNow)` | one shared ticker for countdowns, hydration-safe |

**Money commands are never optimistic (D48).** The page shows only what the server returned.
Approving sends the exact amount the preview showed. If the price moved, the server refuses
with `PRICE_CHANGED` and the new amount, and the dialog asks again. An answer that never arrived
shows "Checking with PayPal…" and re-reads; it is never sent a second time.

### Live updates

`GET /api/v1/stamp` answers with a token of nine counters for the owner's mandate, in this
order: attempts, payment events, PayPal ids, decided holds, policy version, mandate step, vault
deleted, agents, revoked agents. The counters only grow, so comparing two tokens shows what moved
without an event log (D44). `useLive` reads the stamp about once a second and invalidates exactly
the queries each moved counter affects (D49). Polling rests while the tab is hidden. Server-sent
events are not built (D50).

A receipt that arrives while the owner is at the top of the roll prints in place. Further down,
it waits behind a pill ("1 new receipt printed above") rather than push the page.

## The read API

Owner endpoints read the signed session cookie (D43). Without it they answer 401. They answer
JSON with `Cache-Control: no-store` and never a stack trace. Another owner's record is a 404,
the same as one that does not exist.

| Endpoint | Answer |
|---|---|
| `GET /api/v1/receipts?before=&agent=&limit=` | `{ rows: [{ view, agent }], next }`, newest first, keyset-paged |
| `GET /api/v1/receipts/{id}` | the receipt detail: view, offers behind it, timeline, parent and follow-up |
| `GET /api/v1/holds` | `{ pending, decided }` (pending by soonest expiry, the last 20 decided) |
| `GET /api/v1/agents` | `{ agents }`, each with its report card |
| `GET /api/v1/policies` | `{ versions }`, newest first |
| `GET /api/v1/mandate` | the permission slip's summary |
| `GET /api/v1/stamp` | `{ token }` |

The agent side is one call, `POST /api/v1/agent/checkout`, with `Authorization: Bearer slip_live_…`
and `{ productId, chosenOfferUrl, reason }`. It answers 200 with the outcome and the receipt view,
or 400, 401, 403, 409 or 429 with the reason. Agents that speak MCP use `/api/mcp` instead (see
[TOOLS.md](../TOOLS.md)).

## Demo mode

`SLIP_DEMO=1` runs the web app on stand-ins for Channel3 and PayPal, in memory, in one process.
It refuses to start on Vercel, where in-memory state would split across instances. Every page
says it is simulated.

- **Sign-in** opens a fresh desk: an owner, a permission in force, an agent (shopper-1) and four
  purchases (paid, rejected, held above the cap, held with no prices). Each visitor's products
  have their own ids, so one desk's price change or outage never reaches another (D46).
- **PayPal calls take time** (`SLIP_DEMO_LATENCY_MS`, default 2000), so INITIATED, CAPTURING and
  VOIDING can be seen, and a resolver loop finishes what is left pending (D47).
- **`/demo`** sends the console's own agent (shopper-2) on six errands, with PayPal answering,
  timing out, declining or leaving the payment pending for that purchase. It can also settle
  pending payments, raise the standing desk's price (approving its hold then meets
  PRICE_CHANGED once Slip's one-minute copy of the listing is stale), issue a key for the agent
  script, and list the stand-in PayPal's calls.
- **`pnpm demo:agent --errand <name>`** plays an agent in a terminal with that key, over Slip's MCP
  server (see the README and [TOOLS.md](../TOOLS.md)).
- A new permission after the kill switch is signed on a simulated PayPal approval page.

| Variable | Default | Meaning |
|---|---|---|
| `SLIP_DEMO` | unset | `1` turns demo mode on |
| `SLIP_BASE_URL` | — | the public URL; plain `http://` keeps the session cookie usable locally |
| `SLIP_DEMO_LATENCY_MS` | 2000 | how long each stand-in PayPal call takes |
| `SLIP_DEMO_MAX_DESKS` | 500 | desks one process will open |
| `SLIP_DEMO_DESKS_PER_ADDRESS` | 10 | desks per visitor address per 10 minutes |
| `SLIP_ENCRYPTION_KEY` | random per process in demo | signs sessions; required outside demo mode |

## Tests

- `pnpm test` covers the kit's components and hooks (Testing Library on jsdom), the tokens'
  contrast, the design lint (no colour literals, gradients, blur shadows or radius above 4px),
  the banned words, and the web app's server code.
- `pnpm web:e2e` runs Playwright against the built app in demo mode. It covers the four seeded
  outcomes, the five-second receipt, approve and decline, live arrival, the demo console and the
  agent script, a price change, two tabs approving one hold, the kill switch during a checkout,
  another desk's receipt, the keyboard and contrast switches, and axe on every page in both
  themes (and on the shortcuts sheet in more contrast).
