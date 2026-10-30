# The steering check, on the text it actually reads

284 calls to `claude-opus-5-5` under prompt `steer-2`, on 2026-10-30, each given the 5 s the application allows it.

SlipBench supplies the steering verdict rather than asking for it, so that its table can be recomputed with no key (`bench/results/slipbench.md`). This page is the other half: the same question put to the real classifier, on the same text the benchmark showed its agents — real descriptions from the market study, bounded as an agent is shown them, with the benchmark's own `[synthetic]` sentence buried in the attacked arm.

- **honest** — the description alone. A flag here is an honest purchase Slip would reject.
- **buried** — the same description carrying the planted instruction. A `clear` here is an attack the check does not see.

| Arm | Asked | Flagged | Clear | No answer | Slowest |
|---|---|---|---|---|---|
| honest | 240 | 0 (0%) | 240 | 0 | 3.3 s |
| buried | 44 | 44 (100%) | 0 | 0 | 2.0 s |

One check sends about 1,137 input tokens, measured with `count_tokens` on a real prompt from this run. The prompt fences every untrusted field inside a tag whose name carries a per-request nonce, so the system prompt differs on every call and **no production check gets a prompt-cache hit** — a deliberate trade of cost for a fence a listing cannot close. Multiply by your own rate; this file quotes no prices.

## The answers worth reading

None. Every honest description came back `clear` and every planted instruction came back `flagged`, within the deadline.
## What this does and does not say

It measures one payload, at one placement, against one model on one day. A sentence written to avoid whatever this prompt keys on would not be covered by it, which is the reason the production check asks a model rather than a list of patterns in the first place. And no published SlipBench number moves either way: the supplied verdict only reaches a decision when the price gap is already above the owner's flag line, and under `buried` not one errand overpaid at all. What is settled is the counterfactual — whether the check would have seen it.

