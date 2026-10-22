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

**What the keys act on** is the list, where a screen has one. `j`/`k` ring through
`main .slip-listpane [data-slip-outcome]`, skipping anything that cannot take focus or has no box
on the screen, and fall back to all of `main` when that finds nothing — which is what a phone does
with the slip it is reading, since the stylesheet hides the list behind it. Without the scoping,
the slip docked beside the roll was a second stop for a receipt the owner was already reading.

`a`/`d` never reach past the receipt in focus. A roll row carries no decision of its own, so a
page-wide fallback from one meant deciding about whatever was docked — a different receipt (D73).
Outside any receipt they still take the first on the page, which is how the holds screen works.

## The workbench

Each screen an owner works in is laid out as a bench with three slots, so a wide display shows the
list and the thing open at once instead of leaving half the window empty:

```tsx
<Workbench
  rail={<>what is waiting, the totals, the filters</>}
  list={<Roll … />}
  dock={children}
/>
```

The arrangement is the stylesheet's: one column below 900 px, list and dock from 900 px, the rail
joining them at 1280 px. Nothing is hidden by width alone — the same parts are only rearranged —
and below 900 px a slip being read replaces the list it was opened from, which is the only place a
way back is shown (`.slip-dock-back`).

**Receipts use a route layout**, `app/receipts/layout.tsx`, holding the rail and the roll with
`{children}` as the dock. Next keeps a layout mounted while its children change, so opening a
receipt leaves the roll scrolled, filtered and live, while the address still names the receipt and
can be linked to or reloaded. The agent filter therefore lives in the bench rather than the
address, which now belongs to the open receipt. Older receipts (`?before=`) mark themselves
`data-archive` and take the whole bench, since a layout cannot read search params.

The roll says which receipt is open: `Roll` and `HoldsTray` take an `openId`, and the row that
matches carries the owner's pen down its inside edge (an inset rule, so nothing shifts) with
`aria-current="page"` on its link. `apps/web` reads the id from the address, which is where it
already lives.

Two further layouts, both plain grids, carry every screen that is not a bench. `.slip-cards` is
for self-contained cards that sit side by side — waiting holds, agent report cards, and the
bench's two pieces of evidence. `.slip-twoup` is for two sheets read together: the limits form and
the picture of what it would do, the permission slip and the stub that cancels it, the demo
console and the log of what PayPal was asked. Both lift the 36rem sheet cap on their direct
children only, so nothing may be stacked inside a `.slip-twoup` column without new CSS.

A bench whose `rail` is left out drops the rail's column too, rather than dealing the list the
rail's width.

### Counting honestly

Two kinds of number appear on the roll and they are labelled apart, because mixing them would be a
claim Slip cannot stand behind:

| | Where it comes from | What it covers |
|---|---|---|
| **All time** (`summariseAgents`) | the agents' report cards, counted by the server | every attempt ever recorded |
| **On this roll** (`countByOutcome`) | the rows loaded in the browser | the newest three pages, and what the outcome filter narrows |

**No total of money spent exists anywhere in Slip** — not in the database, the API or the kit.
`AgentReport.captured` is a count of completed payments, not an amount. Adding the loaded rows up
would describe whichever pages happened to be in memory, so nothing does it.

### What the kit adds for it

| Export | |
|---|---|
| `Workbench` | the three slots above |
| `RollSummary` | the desk's all-time totals |
| `OutcomeFilter` | buttons, not a menu, so the one menu in `main` is still the agent filter the `/` shortcut reaches |
| `Countdown` | how long is left to decide, as a bar that drains and the same thing in words |
| `OutcomeBar` | an agent's outcomes in the stamps' inks, hidden from assistive tech because the numbers sit beneath it |
| `LimitsPicture` | what a draft of the limits would do to one purchase |
| `CopyButton` | takes one value — an id to quote elsewhere — and says "not copied" where the browser refuses, rather than claiming otherwise |
| `summariseAgents` · `countByOutcome` · `filterRows` · `dayOf` · `dayStarts` | the pure parts, so a host can filter and group without the components |

`Roll` takes an optional `days` map (from `dayStarts`) and writes each day inside its first row.
A separator *between* rows would be an item of the list that is not a receipt, which both lies to
a screen reader and fails axe's list rule.

`LimitsPicture` draws through `measureFor` in `@slip/receipt` — the gap-scale maths lifted out of
the receipt's own `measureModel`, so both call one function and a drawing cannot promise what a
real purchase would not do. The verdict beside it comes from `evaluateRules`, the rules themselves.

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

- **Sign-in** opens a fresh desk: an owner, a permission in force, three agents (shopper-1,
  deal-hunter, restock-bot) and thirty receipts. The newest four are shopper-1's this morning
  (paid, rejected, held above the cap, held with no prices) and are the only holds still waiting;
  under them are two earlier days, with their holds decided, so the roll pages, prints a date
  separator, fills the agent filter and shows the payment states a desk that only ever succeeds
  never reaches (D80). Each visitor's products have their own ids, so one desk's price change or
  outage never reaches another (D46).
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
| `SLIP_DEMO_MAX_DESKS` | 500 | desks one process will open, and never frees — a seeded desk measures 789 KB, so size this against the box (`render.yaml` sets 200 for a 512 MB instance) |
| `SLIP_DEMO_DESKS_PER_ADDRESS` | 10 | desks per visitor address per 10 minutes |
| `SLIP_ENCRYPTION_KEY` | random per process in demo | signs sessions; required outside demo mode |

## Tests

- `pnpm test` covers the kit's components and hooks (Testing Library on jsdom), the tokens'
  contrast, the design lint (no colour literals, gradients, blur shadows or radius above 4px),
  the banned words, and the web app's server code.
- `pnpm web:e2e` runs Playwright against the built app in demo mode. It covers the four outcomes
  the roll opens on, the five-second receipt, approve and decline, live arrival, the demo console
  and the agent script, a price change, two tabs approving one hold, the kill switch during a checkout,
  another desk's receipt, the keyboard and contrast switches, and axe on every page in both
  themes (and on the shortcuts sheet in more contrast).
