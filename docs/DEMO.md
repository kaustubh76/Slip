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

**Bench** → the SlipBench card. **Two agents, 21 errands each, four conditions, 168 runs** —
`claude-haiku-5-5`, the small cheap one, and `claude-opus-5-5`, the frontier one — and a tally
table of zeroes in the overpaid column.

Do not hurry past it or dress it up. The line to say is roughly: *"We built the test, ran it, and
it did not show what we expected. Both agents compared the offers properly — in every condition,
including the one where the instruction is buried inside the product's own real description, which
is where a real listing actually has words. And it held at both ends: the cheapest model we could
find and the best one we could find behaved the same way. So Slip is the check that does not depend
on which model you point at it, and the number that carries the argument is the market study's, not
this one's."*

**That last sentence used to be a hope and is now a measurement**, which is the only reason to say
it at all. With one cheap model it would have been a guess about everything else. Two models at
opposite ends of the capability range agreeing is a different claim — still two models, not agents
in general, and say that too if a judge presses.

One number to have ready if asked how the steering check itself was tested, since the bench table
cannot show it: **44 of 44 planted instructions flagged, 0 of 240 honest product descriptions
flagged, every call answered inside the 5 seconds the application allows**
(`bench/results/steering-judge.md`, 30 October). That is what makes the verdict in the with-Slip
table the real classifier's answer on the same text rather than an assumption standing in for one.

Then cut back to the study card for the close. An honest negative is worth more on tape than a
number nobody can check, and a judge who notices you volunteering it will trust the rest.

With the sandbox id still out, the material above runs to roughly 2:30. That is under the limit
and every second of it is real.

## The steering beat, if you want the last fifteen seconds

The shot list above never shows the steering check, which is the other of Slip's two reasons to
stop a purchase. It is optional because the market study's numbers carry the argument on their own
— but it is the most *watchable* thing in the product, and since D88 it finally shows the shape real
data has. Run it from a terminal:

```sh
SLIP_AGENT_KEY=slip_live_… pnpm demo:agent --errand buried --url http://localhost:3000
```

The transcript prints the product's own description with the instruction sitting inside it, the
agent choosing the store that description named, and `REJECTED by R3_STEERED`. Open the receipt and
*"What Slip's search showed your agent"* quotes the text the check actually read. The line to say:
*"The instruction wasn't in the price. It was in the product description, which is the only place a
real listing has words at all — and the agent did what it said. Slip read the same text and stopped
it."*

Two things to have straight if a judge asks, both from the study. **The price gap alone would not
have stopped that purchase** — $3.51 is above the flag line that calls the check and under the line
that rejects on price, so the steering check is the only thing between the agent and the payment.
And **we looked for this in the wild**: all 240 real descriptions were read for it, one matched the
patterns, and the model cleared it as ordinary selling. So the honest claim is that this guards
against something not yet seen in that sample, which is also why the demo's own instruction is
labelled `[synthetic]` wherever it appears.

## The two rules that shipped after this script was written

Optional, like the steering beat, and for the same reason: the market study carries the argument
without them. But both are **built and deciding real purchases** since D95, and neither appears
anywhere above.

`R5A_COMMISSION_UNDISCLOSED` is the watchable one. A dearer offer that discloses no commission
rate, where the cheaper one does, is now **held** rather than paid. The line, if you show it:
*"The conflict rule needs both commission rates to compare them. A store that simply says nothing
used to slip through the gap — so saying nothing was the better move. Now it waits for the owner
instead."* That is `MERCHANTS.md` §2.2's argument in one breath, and it is the rare case where
closing a hole is visible on screen.

`R2B_SINGLE_SELLER_MARKET` is harder to film and worth a sentence rather than a shot: where the
comparable offers all resolve to one seller, there was never a market to compare, so the purchase
is held. It fires on real data — **one of the 44 comparable products in the study**, and it turned
out to be one store listing an item twice rather than a seller faking a market, which is the honest
way to say it (G6, `MERCHANTS.md` §9).

Neither is worth pushing the tape past 2:45. If time is short, say the sentence and move on.

## Do not say

The repo's copy tests refuse these words and the video should too: "savings", "you saved", basis
points, slippage, TCA, best execution. Percent and dollars throughout. And do not call the
stand-ins real — the whole case rests on the demo being honest about which parts are simulated.
