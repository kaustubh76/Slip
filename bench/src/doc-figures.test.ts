import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { RULE_OUTCOME } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { CONDITIONS } from "./conditions.js";

/**
 * Seven documentation passes found the same defect seven times: a figure written into prose goes
 * stale when the thing it measures changes. `84 runs` outlived the second agent by four days in
 * five documents; `126 errands` described the whole sweep when it is the three-planted-condition
 * share of it. This pins the figures to what produces them, so the eighth one fails here instead
 * of waiting for somebody to sweep by hand.
 *
 * Nothing below is retyped. Every expected number is derived from `bench/results/slipbench.json`,
 * `CONDITIONS`, `RULE_OUTCOME` or the decision ledger's own headings.
 *
 * The honest division of labour between the two tests, because the weaker one reads stronger than
 * it is: the slice test catches a figure that matches *nothing* the bench can produce — a typo, a
 * `5 conditions`, a leftover from a differently shaped sweep. It would have caught **none of the
 * seven**, because `84` and `126` are both real slices; they were simply in the wrong sentence.
 * The pinned-headline test is the one that catches that, and so the one that matters. An
 * arithmetic cross-check on lines stating their own factors was tried and dropped: only two
 * sentences in the corpus state all their factors as digits, and one of them says "each".
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), "utf8");

/**
 * These documents are hard-wrapped near 100 characters, so a pinned phrase can have a newline
 * anywhere inside it — `1,118,897` ended one line and `input` began the next. Collapse whitespace
 * before matching, or the guard fails on correct prose the moment a paragraph is rewrapped.
 */
const flat = (path: string): string => read(path).replace(/\s+/g, " ");

interface Tally {
  readonly agent: string;
  readonly errands: number;
}

const tallies: readonly Tally[] = JSON.parse(read("bench/results/slipbench.json")).tallies;
const AGENTS = new Set(tallies.map((row) => row.agent)).size;
const ERRANDS = Math.max(...tallies.map((row) => row.errands));
const RUNS = AGENTS * CONDITIONS.length * ERRANDS;

/**
 * The published report is the only source for what the runs found. Both of these moved under this
 * session's feet when a peer finished the Opus `buried` arm (`c03a30e`): the non-purchase count
 * fell from 10 to 7 and the token totals rose, and five documents had to be corrected again. They
 * are pinned here so the next such change fails instead of being noticed by eye.
 */
const published = read("bench/results/slipbench.md");
const MISSES = Number(/(\d+) of \d+ runs did not buy/.exec(published)?.[1]);
const COST = /\*\*([\d,]+) in\*\*, \*\*([\d,]+) out\*\*, over ([\d,]+) model turns/.exec(published);

const ledger = read("docs/DECISIONS.md");
const DECISION_NUMBERS = [...ledger.matchAll(/^## D(\d+)/gm)].map((m) => Number(m[1]));
const DECISIONS = DECISION_NUMBERS.length;
const LATEST = Math.max(...DECISION_NUMBERS);

/**
 * The living documents — the ones that describe how Slip is now. `DECISIONS.md` is deliberately
 * absent: it is a dated ledger, and an entry that still says `84 runs` is a record of what was
 * believed that day, which is the point of keeping it.
 */
const LIVING = [
  "README.md",
  "TOOLS.md",
  "docs/SPEC.md",
  "docs/DEMO.md",
  "docs/DEPLOY.md",
  "docs/SERVICES.md",
  "docs/MERCHANTS.md",
  "docs/RAILS.md",
  "docs/UI.md",
  "docs/DIAGRAM.md",
];

/**
 * A line states a claim about now unless it dates itself or describes something superseded. The
 * schedule's `| Oct 16–17 | Throwaway bench: 10 errands × 3 agents × 3 conditions |`, gate G3's
 * `≥15% of 10 errands`, "the 63 runs committed on 21 Oct" and the Opus pilot's 2 errands are all
 * true records of a past or planned shape, and records are allowed to hold figures that have since
 * moved. `✎` marks the same thing inline, in DIAGRAM.md's idiom. `\bpilot` and not `\bpiloted\b`,
 * because the same paragraph says both "had been piloted" and "a pilot's 2 errands".
 */
const HISTORICAL =
  /✎|\bthe plan\b|\bpilot|^\s*\|\s*(?:G\d|Oct|Nov)\b|\b(?:Oct|Nov|Sep)\s+\d|\d+\s+(?:Oct|Nov|Sep)\b/i;

/**
 * The lookbehind keeps a section reference out of it: `§3.3 rule` and `§19.4 conditions` both end
 * in a digit followed by a unit, and neither is a count of anything.
 */
const FIGURE =
  /(?<![\d.])(\d[\d,]*)\s+(runs?|errands?|agents?|conditions?|rules?|decisions?|entries)/g;

/** Every count the sweep can legitimately be sliced into: per agent, per condition, or whole. */
const SLICES = new Set<number>();
for (let a = 1; a <= AGENTS; a += 1) {
  for (let c = 1; c <= CONDITIONS.length; c += 1) SLICES.add(a * c * ERRANDS);
}

const ALLOWED: Record<string, ReadonlySet<number>> = {
  run: SLICES,
  errand: SLICES,
  agent: new Set(Array.from({ length: AGENTS }, (_, i) => i + 1)),
  condition: new Set(Array.from({ length: CONDITIONS.length }, (_, i) => i + 1)),
  rule: new Set([Object.keys(RULE_OUTCOME).length]),
  decision: new Set([DECISIONS]),
  entries: new Set([DECISIONS]),
};

describe("the figures in prose", () => {
  it("cites no count the bench cannot produce", () => {
    // A floor, so a bad path or a renamed doc fails loudly instead of passing on an empty corpus.
    expect(LIVING.filter((path) => existsSync(join(root, path))).length).toBeGreaterThan(8);

    const wrong: string[] = [];
    let checked = 0;
    for (const path of LIVING) {
      const lines = read(path).split("\n");
      for (const [index, line] of lines.entries()) {
        if (HISTORICAL.test(line)) continue;
        for (const match of line.matchAll(FIGURE)) {
          const value = Number(match[1]?.replace(/,/g, ""));
          const unit = match[2]?.replace(/s$/, "") ?? "";
          const allowed = ALLOWED[unit] ?? ALLOWED[`${unit}s`];
          if (!allowed) continue;
          checked += 1;
          if (!allowed.has(value)) wrong.push(`${path}:${index + 1} says ${value} ${match[2]}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(15);
    expect(wrong.join("\n")).toBe("");
  });

  it("states the sweep that was actually run, wherever it states one", () => {
    // The sentences that carry the headline. `84` and `126` are real slices, so only naming the
    // sentence catches one standing where the whole sweep belongs — which is the bug seven passes
    // kept finding.
    const claims: ReadonlyArray<readonly [string, string]> = [
      ["docs/SPEC.md", `${AGENTS} agents × ${CONDITIONS.length} conditions × ${ERRANDS} errands`],
      ["docs/SPEC.md", `${RUNS} runs`],
      ["bench/results/slipbench.md", `${AGENTS} agents × ${CONDITIONS.length} conditions`],
      [
        "docs/SERVICES.md",
        `${ERRANDS} errands × ${CONDITIONS.length} conditions each = ${RUNS} runs`,
      ],
      ["README.md", `${RUNS} runs`],
      ["docs/DEMO.md", `${RUNS} runs`],
      ["docs/DEPLOY.md", `${RUNS} runs`],
      ["README.md", `${MISSES} of the ${RUNS} runs did not buy`],
      ["docs/SPEC.md", `${MISSES} of the ${RUNS} runs did not buy`],
      ["docs/SERVICES.md", `${COST?.[1]} input`],
      ["docs/SERVICES.md", `${COST?.[2]} output`],
      ["docs/SERVICES.md", `${COST?.[3]} turns`],
    ];
    expect(Number.isInteger(MISSES)).toBe(true);
    expect(COST).not.toBeNull();
    expect(claims.length).toBeGreaterThan(6);
    for (const [path, needle] of claims) {
      expect(flat(path), `${path} should state "${needle}"`).toContain(needle);
    }
  });

  it("names the flag wherever it says when the paid tool exists", () => {
    // Narrow by design, and a co-occurrence check rather than a semantic one: `search_products` is
    // the only agent call that spends money, and D106 put it behind a second switch beside the
    // key. The three documents that describe *when* the tool exists must name that switch — one
    // went on saying "when `CHANNEL3_API_KEY` is set" long enough to contradict its own earlier
    // paragraph, and `TOOLS.md`, the one an agent author actually reads, stated the old condition
    // without ever repeating the tool's name, so a grep for `search_products` walked past it.
    // The flag is read out of the condition so renaming it cannot strand this.
    //
    // A stronger version was tried and rejected: requiring any *paragraph* that names the key and
    // the word "search" to name the flag. It fails on a service-config table and a shell example
    // in SERVICES.md, neither of which states a condition — two false alarms out of four matches.
    // Mentioning the key near the word search is not the same as stating when the tool exists.
    const condition = /catalogueSearch:[^;]*?env\["(\w+)"\][^;]*?env\["(\w+)"\]/.exec(
      read("apps/web/src/server/services.ts"),
    );
    expect(condition).not.toBeNull();
    const flag = [condition?.[1], condition?.[2]].find((name) => name !== "CHANNEL3_API_KEY");
    expect(flag).toBeTruthy();

    for (const path of ["README.md", "TOOLS.md", "docs/SERVICES.md"]) {
      const text = read(path);
      if (!text.includes("search_products")) continue;
      expect(text, `${path} describes search_products without naming ${flag}`).toContain(
        flag as string,
      );
    }
  });

  it("breaks no file path across a line, where markdown would insert a space", () => {
    // Markdown renders a newline inside a code span as a space, so a path wrapped mid-way renders
    // as `.../checkout/ route.ts` — a path that does not exist, in the sentence telling a reader
    // which file to open. These documents wrap at 100 characters and the paths are long, so any
    // path near a wrap point is a candidate.
    //
    // The rule is deliberately the narrowest one that works: flag a break immediately after
    // `/`, `.`, `_`, `-` or `@`, where a space is never part of the token. Two looser rules were
    // measured and rejected — "the span has no other whitespace" and "either half starts or ends
    // mid-token" each flag `POST` + `/api/v1/agent/checkout`, `vercel … --billing-plan free_v3`
    // and `--errands 2 --conditions clean`, all of which want the space they have. This rule
    // flags none of the seven wrapped spans in the repository today and does flag the defect it
    // was written for.
    //
    // `-` and `@` earn their place by the same measurement, over all 2,577 code spans in the
    // repository's Markdown. `@` is clean: not one span has a legitimate space after it, and
    // `@slip/ui` wrapped after the `@` ruins a package name. The hyphen needed one more turn —
    // a re-count found **three** spans with a legitimate space after `-`, all of them arithmetic:
    // `scrollWidth - clientWidth`, `calc(100vw - 32px)` and a list bullet. So the hyphen is
    // flagged only when it is *not* preceded by whitespace, which is the difference between a
    // token (`verify-deployment.ts`) and an operator (`a - b`). Without that guard the three
    // would have become false alarms on their first reflow — the same test that kept `:`, `,`
    // and `=` out. 214 spans contain a hyphenated token, and this project's filenames are
    // hyphen-heavy (`verify-deployment.ts`, `owner-start.spec.ts`, `doc-figures.test.ts`), so the
    // character is worth having with that restriction.
    //
    // `:`, `,` and `=` are deliberately **out**, by the rule that a check must not condemn correct
    // prose: 75 spans read `plan: free` or similar, 35 read `{ store, url, price }`, and 7 read
    // `reconcileUnmatched === 1`. None of them wraps at that point today, so each would be a
    // cry-wolf waiting for a reflow rather than a defect waiting to be caught.
    const offenders: string[] = [];
    // Every document, the ledger included. `LIVING` excludes `docs/DECISIONS.md` from the *figure*
    // checks because a dated entry is allowed to keep what was believed that day — but a path
    // broken by a line wrap is not a record of anything, it is just broken, and it misleads a
    // reader of an old entry exactly as much as a new one.
    const rendering = [
      ...LIVING,
      "docs/DECISIONS.md",
      "bench/results/slipbench.md",
      "bench/results/steering-judge.md",
      "study/results/market-study.md",
    ];
    for (const path of rendering) {
      // Blank out fenced blocks, preserving newlines so reported line numbers stay true.
      const text = read(path).replace(/```[\s\S]*?```/g, (block) => block.replace(/[^\n]/g, " "));
      const parts = text.split("`");
      let offset = 0;
      for (const [index, part] of parts.entries()) {
        // Backticks alternate, so odd indices are span contents. Pairing them by regex instead
        // matches the prose *between* two spans and reports hundreds of phantom hits.
        if (index % 2 === 1 && part.includes("\n")) {
          const halves = part.split(/\s*\n\s*/);
          const left = halves[0] ?? "";
          if (/[/._@]$|(?<!\s)-$/.test(left)) {
            const line = text.slice(0, offset).split("\n").length;
            offenders.push(`${path}:${line} renders as "${part.replace(/\s*\n\s*/g, " ")}"`);
          }
        }
        offset += part.length + 1;
      }
    }
    expect(offenders.join("\n")).toBe("");
  });

  it("lists in every rule table exactly the rules the code implements", () => {
    // The mechanical diff that part seven ran by hand: `RULE_OUTCOME` is the only source, and the
    // spec's table and the printed one-pager must both agree with it on code and outcome.
    const expected = new Map(Object.entries(RULE_OUTCOME));

    const section = read("docs/SPEC.md").split("### 5.1")[1]?.split("**✎ D2,")[0] ?? "";
    const spec = new Map(
      [...section.matchAll(/\|\s*`(\w+)`\s*\|[^|]*\|\s*(PAID|HELD|REJECTED)/g)].map((m) => [
        m[1] as string,
        m[2] as string,
      ]),
    );
    expect([...spec.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [code, outcome] of spec) expect(outcome).toBe(expected.get(code));

    // The one-pager is a printed artifact rather than a source file, so it is checked when present.
    const overview = join(root, "docs/Slip-overview.html");
    if (!existsSync(overview)) return;
    const html = readFileSync(overview, "utf8");
    const printed = new Map(
      [...html.matchAll(/<td class="mono">(\w+)<\/td>[\s\S]*?class="pill \w+">(\w+)</g)].map(
        (m) => [m[1] as string, m[2] as string],
      ),
    );
    expect([...printed.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [code, outcome] of printed) expect(outcome).toBe(expected.get(code));
    expect(html).toContain(`${DECISIONS} entries, latest D${LATEST}`);
  });
});
