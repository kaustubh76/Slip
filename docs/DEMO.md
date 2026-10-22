# Filming Slip

A shot list for the submission video. §16 of the spec sets the target at 2:45; this is the version
with the actual clicks in it, and it covers **only what works today**. Two of §16's beats cannot be
filmed yet and are marked so at the bottom rather than quietly dropped.

## Before you record

```sh
pnpm install && pnpm web:build
SLIP_DEMO=1 SLIP_BASE_URL=http://localhost:3000 pnpm --filter @slip/web start
```

Open <http://localhost:3000> and **Open a demo desk**. Keep a terminal beside the browser: two
shots use it. Nothing here needs an API key, and the disclosure band says so on every screen —
leave it visible, it is the honest part of the pitch.

One desk per recording. If you restart the server, open a new desk: the stand-ins keep their state
in the process.

**Filming the hosted demo instead?** Load the URL once and wait for it before you start recording.
A free Render instance sleeps after 15 minutes and takes about a minute to wake, and that minute
should not be on the tape. The same spin-down discards any desk that was open, so open yours after
it is awake, not before.

---

## The shots

**0:00–0:12 · The problem.** Terminal, full screen. Run the agent against a desk you have already
opened:

```sh
SLIP_AGENT_KEY=slip_live_… pnpm demo:agent --errand top-pick --url http://localhost:3000
```

Let it print its search and its choice. *"An agent just picked something to buy. It chose the
offer that was listed first and labelled 'Top pick'. Nobody checked whether that was the cheapest."*

**0:12–0:30 · What we measured.** Cut to **Bench**. The Market study card is on screen with the
stamp reading MEASURED · THIN. Read the numbers off it — 240 real products, 18.33% with two or
more comparable offers, typical spread 16.67%, and the dearer offer paying more commission 47.5%
of the time. *"That 18% is the honest number. Most products have one offer, so most purchases
cannot be compared at all — and where they can, the gap is real money."* Do not skip the stamp;
the study failing its own bar and saying so is the most credible second on the tape.

**0:30–1:15 · Rejected, then paid.** Back to the terminal, same errand. Slip's receipt prints in
the transcript: rejected, with the cheaper listing named. Cut to **Receipts** — the row is already
there, no reload. Click it. The slip reads in one breath: what the agent tried, the same item for
less elsewhere, overpaid by N%, nothing charged. Fold open **Behind the receipt** and show the
offers table with LOWEST and CHOSEN marked, and the rules that tripped.

Then run the retry:

```sh
SLIP_AGENT_KEY=slip_live_… pnpm demo:agent --errand cheaper --url http://localhost:3000
```

Cut to the roll and watch the new receipt's status line walk INITIATED → CAPTURED. *"Same agent,
cheaper offer. Slip pays that one."*

**1:15–1:35 · A hold, and a human.** **Holds**. Two are waiting, each with the time left draining,
and under them the ones this desk already decided. Take the one above the order cap. Press **Approve…** and stop on the dialog: it names the exact
amount and the store. Cancel it. Press **Decline…** and confirm. The status line walks VOIDING →
VOIDED. *"Above the limit the owner set, so it waits. Declining releases the money; nothing was
charged."*

**1:35–2:05 · It is not a demo-shaped product.** **Limits** — change "reject above" from 5% to 1%
and let the picture beside it redraw as you type: the band narrows and the verdict flips to
rejected. *"These are the owner's numbers, and every receipt records which version it was decided
under."* Then **Mandate** — the permission slip, the limits on it, and the tear-off stub. Type
REVOKE and **Tear the slip**. Cut to the terminal and run any errand: refused.

**2:05–2:30 · Where it runs for real.** **Demo** console, "Connect an agent". Show the
`claude mcp add` line. If you have Claude Code open, add it and ask for a pair of trail shoes, and
let Slip decide on the roll. *"Any MCP client. The agent never holds the payment method — Slip
does, and the agent can only pay through it."* Say the sandbox sentence here: in the demo PayPal
is a stand-in in this process, Slip is the merchant of record, and no order reaches a retailer.

**2:30–2:45 · Close.** The roll, full screen. Scroll it once: three agents, two days, every
outcome and every state PayPal leaves a payment in. *"Every purchase an agent tries, checked
before the money moves, with a receipt that says why."*

---

## The one thing that cannot be filmed yet

Say it rather than stage it.

**A real PayPal sandbox id on screen** (§16's 0:30–1:15 asks for one). The demo's payment is the
stand-in, which the band on every page states. Filming a real sandbox id needs the vaulted sandbox
buyer from `docs/SERVICES.md` — the one step nothing can automate — and a Channel3 key for the
agent's search. Until then the demo shows the decision, which is the part Slip is for.

SlipBench was the other one until 21 Oct. It has run, and its beat is below.

## The SlipBench beat, now that it has run (§16's 1:35–2:15)

**Bench** → the SlipBench card. One agent, 21 errands, three conditions, 63 runs, and a tally
table of zeroes in the overpaid column.

Do not hurry past it or dress it up. The line to say is roughly: *"We built the test, ran it, and
it did not show what we expected. This agent compared the offers properly — in every condition,
including the one where the pricier listing is addressed to shopping agents. So Slip is the check
that does not depend on which model you point at it, and the number that carries the argument is
the market study's, not this one's."*

Then cut back to the study card for the close. An honest negative is worth more on tape than a
number nobody can check, and a judge who notices you volunteering it will trust the rest.

With the sandbox id still out, the material above runs to roughly 2:30. That is under the limit
and every second of it is real.

## Do not say

The repo's copy tests refuse these words and the video should too: "savings", "you saved", basis
points, slippage, TCA, best execution. Percent and dollars throughout. And do not call the
stand-ins real — the whole case rests on the demo being honest about which parts are simulated.
