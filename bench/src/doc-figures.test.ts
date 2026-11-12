import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

/**
 * A unit is the smallest piece of a markdown document that stands on its own: a paragraph, a list
 * item, a table row. Paragraphs alone are too coarse for the rules below — the three defects they
 * exist for were a paragraph, one bullet inside a ten-bullet list, and a line of a checklist, and
 * a bullet whose sibling happens to say the right thing is still a bullet that misleads.
 */
const units = (text: string): string[] => {
  const found: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.join(" ").trim() !== "") found.push(current.join(" "));
    current = [];
  };
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flush();
      continue;
    }
    // A bullet, a numbered item or a table row begins a new unit; its continuation lines do not.
    if (/^\s*(?:[-*]\s|\d+\.\s|\|)/.test(line)) flush();
    current.push(line.trim());
  }
  flush();
  return found;
};

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
 * Every Markdown document in the repository, the ledger and the generated reports included. The
 * *figure* checks use `LIVING` instead, which excludes the ledger, because a dated entry may keep
 * what was believed that day — but a citation to a file that no longer exists, or a link to a
 * heading that was renamed, is broken for a reader of an old entry exactly as much as a new one.
 */
const CITED = [
  ...LIVING,
  "docs/DECISIONS.md",
  "bench/results/slipbench.md",
  "bench/results/steering-judge.md",
  "study/results/market-study.md",
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
    // flags nothing in the repository today and does flag the defect it was written for.
    //
    // `-` and `@` earn their place by the same measurement, taken over every code span in the
    // repository's Markdown. `@` is clean: not one span has a legitimate space after it, and
    // `@slip/ui` wrapped after the `@` ruins a package name. The hyphen needed one more turn — a
    // re-count found spans with a legitimate space after `-`, all of them arithmetic:
    // `scrollWidth - clientWidth`, `calc(100vw - 32px)` and a list bullet. So the hyphen is
    // flagged only when it is *not* preceded by whitespace, which is the difference between a
    // token (`verify-deployment.ts`) and an operator (`a - b`). Without that guard those would
    // have become false alarms on their first reflow — the same test that kept `:`, `,` and `=`
    // out. Many spans contain a hyphenated token and this project's filenames are hyphen-heavy
    // (`verify-deployment.ts`, `owner-start.spec.ts`, `doc-figures.test.ts`), so the character is
    // worth having with that restriction. **D108 and D111 hold the counts, with their dates.**
    //
    // The restriction is `(?<=[^\s])` and not `(?<!\s)`, which is not pedantry: a *negative*
    // lookbehind is satisfied by the absence of any character, so `(?<!\s)-$` fires on a left half
    // that is only the hyphen — the `- store: …` bullet wrapped immediately after the bullet.
    // Requiring a character that exists and is not whitespace is the whole fix, and the empty-left
    // case is its only behavioural difference: every token case above fires either way.
    //
    // `:`, `,` and `=` are deliberately **out**, by the rule that a check must not condemn correct
    // prose: spans read `plan: free`, `{ store, url, price }` and `reconcileUnmatched === 1` in
    // numbers, and none of them wraps at that point today, so each would be a cry-wolf waiting
    // for a reflow rather than a defect waiting to be caught.
    const BREAKS_A_TOKEN = /[/._@]$|(?<=[^\s])-$/;

    // The rule took three passes and each one was a real defect, so its behaviour is pinned here
    // rather than left to the corpus — a corpus that happens to contain no offender today cannot
    // tell you the rule still works.
    for (const left of ["apps/web/src/app/api/v1/agent/checkout/", "doc-", "@slip/", "offer."]) {
      expect(BREAKS_A_TOKEN.test(left), `${left} should break a token`).toBe(true);
    }
    for (const left of ["POST", "scrollWidth -", "calc(100vw -", "pnpm", "409", "-"]) {
      expect(BREAKS_A_TOKEN.test(left), `${left} should not`).toBe(false);
    }

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
          if (BREAKS_A_TOKEN.test(left)) {
            const line = text.slice(0, offset).split("\n").length;
            offenders.push(`${path}:${line} renders as "${part.replace(/\s*\n\s*/g, " ")}"`);
          }
        }
        offset += part.length + 1;
      }
    }
    expect(offenders.join("\n")).toBe("");
  });

  it("cites no pnpm script that no package defines", () => {
    // The class the other session hit on 1 Nov: a document printing an instruction that cannot
    // succeed. Theirs could not succeed for a reason no checker can see — the command existed but
    // the key it needed had been discarded. This catches the mechanical half: a script that was
    // renamed, removed or mistyped, leaving a command in prose that fails on the first line.
    //
    // Scope, stated because it is narrower than the finding that prompted it: **this proves the
    // script exists, never that it can work.** `pnpm test:live:paypal` is defined and still cannot
    // run against the deployment, because the vault id is encrypted under a key only the
    // deployment holds. A command that exists and fails for want of a credential, a grant or a
    // database is exactly what this does not see.
    const defined = new Set<string>();
    const manifests = [
      "package.json",
      "study/package.json",
      "bench/package.json",
      "tests/package.json",
    ];
    for (const dir of ["packages", "apps"]) {
      for (const name of readdirSync(join(root, dir)))
        manifests.push(`${dir}/${name}/package.json`);
    }
    for (const manifest of manifests) {
      const file = join(root, manifest);
      if (!existsSync(file)) continue;
      for (const name of Object.keys(JSON.parse(readFileSync(file, "utf8")).scripts ?? {})) {
        defined.add(name);
      }
    }
    expect(defined.size).toBeGreaterThan(20);

    // Only inside code — a fenced block or a span. In prose, "because pnpm has a built-in
    // `doctor`" reads as a citation of a script named `has`, and did.
    const reserved = new Set(["run", "install", "i", "exec", "dlx", "add", "remove", "why", "ls"]);
    const cited = new Map<string, string>();
    for (const path of [...LIVING, "bench/results/slipbench.md", "study/results/market-study.md"]) {
      const raw = read(path);
      const chunks = [...raw.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((m) => m[1] ?? "");
      const prose = raw.replace(/```[\s\S]*?```/g, "");
      chunks.push(...prose.split("`").filter((_, index) => index % 2 === 1));
      for (const chunk of chunks) {
        for (const match of chunk.matchAll(/\bpnpm (?:-s |--silent )?([a-z][\w:.-]*)/g)) {
          const name = match[1] ?? "";
          if (!reserved.has(name)) cited.set(name, path);
        }
      }
    }
    expect(cited.size).toBeGreaterThan(15);

    const unknown = [...cited].filter(([name]) => !defined.has(name));
    expect(unknown.map(([name, path]) => `${path} cites \`pnpm ${name}\``).join("\n")).toBe("");
  });

  it("cites no file that is missing, and no line past the end of one", () => {
    // These documents carry several hundred `path:line` citations. A file that moves or shrinks
    // leaves one pointing at nothing, and nothing checked them until now. D111 has the count on
    // the day it was taken; it is not repeated here, because it changes every time the ledger
    // grows — which is how the figures that used to be in these comments went stale (D113).
    //
    // **Longest extension first.** Ordered alternation is why the first run of this reported
    // eleven missing paths that all existed: `js` before `json` truncated `apps/web/vercel.json`
    // to `apps/web/vercel.js`, and `ts` before `tsx` did the same to every `.tsx` view. Six
    // identical phantom hits across six files is the shape of a tool bug, not a finding.
    const CITE =
      /((?:apps|packages|study|bench|tests|docs|\.github)\/[\w./-]+\.(?:tsx|ts|mjs|json|js|yaml|yml|sql|css|md))(?![\w])(?::(\d+))?/g;

    const offenders = (corpus: ReadonlyArray<readonly [string, string]>): string[] => {
      const out: string[] = [];
      for (const [doc, text] of corpus) {
        for (const [index, line] of text.split("\n").entries()) {
          for (const match of line.matchAll(CITE)) {
            const cited = match[1] ?? "";
            const at = match[2];
            const file = join(root, cited);
            if (!existsSync(file)) {
              out.push(`${doc}:${index + 1} cites ${cited}, which does not exist`);
            } else if (at !== undefined) {
              const lines = readFileSync(file, "utf8").split("\n").length;
              if (Number(at) > lines) {
                out.push(`${doc}:${index + 1} cites ${cited}:${at}, but it has ${lines} lines`);
              }
            }
          }
        }
      }
      return out;
    };

    // Sensitivity, pinned here rather than checked once by hand: three instruments in this file's
    // history reported defects that did not exist, and a rule that has quietly stopped matching
    // reports a reassuring zero. Both halves of the rule must still fire.
    expect(offenders([["probe.md", "see `packages/nope/missing.ts`"]])).not.toEqual([]);
    expect(offenders([["probe.md", "see `bench/src/conditions.ts:99999`"]])).not.toEqual([]);
    expect(offenders([["probe.md", "see `bench/src/conditions.ts:12`"]])).toEqual([]);

    const corpus = CITED.map((path) => [path, read(path)] as const);
    expect(corpus.length).toBeGreaterThan(10);
    expect(offenders(corpus).join("\n")).toBe("");
  });

  it("links to no heading that does not exist", () => {
    // A renamed heading does not break a markdown link, it silently lands the reader at the top of
    // the page, which is worse than a 404 because nothing announces it.
    //
    // Slugs are built the way GitHub builds them, and the detail that matters is the last step:
    // **each space becomes its own hyphen.** Collapsing runs reported `DIAGRAM.md:11` as broken,
    // because `## D82 · 2026-10-23 · …` leaves two spaces where the `·` was and so slugs to
    // `d82--2026-10-23--…` with doubled hyphens. The link was right; the instrument was not.
    const slugs = (markdown: string): Set<string> => {
      const body = markdown.replace(/```[\s\S]*?```/g, "");
      const out = new Set<string>();
      for (const match of body.matchAll(/^#{1,6}\s+(.*)$/gm)) {
        const text = (match[1] ?? "")
          .replace(/`([^`]*)`/g, "$1")
          .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
          .replace(/[*_]/g, "")
          .trim()
          .toLowerCase()
          .replace(/[^\w\s-]/g, "");
        out.add(text.replaceAll(" ", "-"));
      }
      return out;
    };

    const offenders = (corpus: ReadonlyArray<readonly [string, string]>): string[] => {
      const out: string[] = [];
      for (const [doc, text] of corpus) {
        for (const [index, line] of text.split("\n").entries()) {
          for (const match of line.matchAll(/\]\((?!https?:)([^)#]*)#([^)]+)\)/g)) {
            const target = match[1] ?? "";
            const fragment = (match[2] ?? "").toLowerCase();
            const file = target === "" ? join(root, doc) : join(root, dirname(doc), target);
            if (!existsSync(file)) {
              out.push(`${doc}:${index + 1} links to ${target}, which does not exist`);
            } else if (!slugs(readFileSync(file, "utf8")).has(fragment)) {
              out.push(`${doc}:${index + 1} links to ${target}#${fragment}, which is no heading`);
            }
          }
        }
      }
      return out;
    };

    expect(offenders([["docs/x.md", "see [D82](DECISIONS.md#no-such-heading)"]])).not.toEqual([]);
    expect(offenders([["docs/x.md", "see [gone](NOPE.md#whatever)"]])).not.toEqual([]);
    expect(
      offenders([
        [
          "docs/x.md",
          "see [D82](DECISIONS.md#d82--2026-10-23--the-diagram-read-back-against-the-code)",
        ],
      ]),
    ).toEqual([]);

    const corpus = CITED.map((path) => [path, read(path)] as const);
    expect(offenders(corpus).join("\n")).toBe("");
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

  it("prints the one-pager's PDF from the one-pager that is on disk now", () => {
    // The rule above kept the HTML's decision figure current. Nothing held the PDF to anything, so
    // it sat ten days and five entries behind the page it was printed from — 109/D114 against
    // 114/D119 — and the PDF is the copy that gets attached to a form (D120).
    //
    // Hashing the PDF would prove nothing: Chromium stamps a creation date, so two prints of one
    // file differ. `pnpm overview:pdf` therefore records the hash of its *source*, and this asserts
    // that source is still what is here.
    //
    // What it cannot do: it says the PDF is stale, never that either file's figures are right.
    // Nothing here would have caught the Postgres row drifting from 310 to 320 — that took running
    // the suite the figure describes.
    const overview = join(root, "docs/Slip-overview.html");
    const stamp = join(root, "docs/Slip-overview.pdf.sha256");
    if (!existsSync(overview) || !existsSync(stamp)) return;

    const printedFrom = readFileSync(stamp, "utf8").trim();
    const onDisk = createHash("sha256").update(readFileSync(overview)).digest("hex");
    expect(printedFrom, "docs/Slip-overview.pdf is stale — run `pnpm overview:pdf`").toBe(onDisk);
  });

  it("declares in .env.example every variable the application reads", () => {
    // `doctor.ts` tells an operator to copy this file, so a variable it omits is one they will
    // never set. Four were omitted: `CRON_SECRET`, whose absence stops all housekeeping and whose
    // name only Vercel decides (D76); `SLIP_AGENT_SEARCH`, which decides whether an agent is
    // offered the one tool that spends money (D106); and the two sandbox buyer credentials, asked
    // for in a message and documented nowhere.
    //
    // It demands a fillable `NAME=` line rather than a mention, because a mention is exactly how
    // `CRON_SECRET` hid: the prose named it while the only line to fill in was `SLIP_CRON_SECRET`,
    // which is the name that answers 401 to its own cron on Vercel for ever.
    //
    // What it cannot do: it checks that a variable is named, never that a value would be sane.
    // Whether a default stated beside it is true is the rule below, which exists because this one
    // passed over three figures that were wrong.
    const PLATFORM = [
      "NODE_ENV", // the runtime sets it
      "VERCEL", // Vercel sets it; Slip reads it only to know where it is
      "RENDER_EXTERNAL_URL", // Render sets it, and `publicBaseUrl` prefers SLIP_BASE_URL anyway
      "SLIP_E2E_PORT", // playwright.config.ts — a test harness, not a deployment
      "SLIP_E2E_OWNER_PORT", // the same
    ];
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        const next = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          // `__contract__` and a test file read variables to drive themselves, which is not a
          // promise to anybody deploying this.
          if (!["node_modules", "dist", "__contract__"].includes(entry.name)) walk(next);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          sources.push(next);
        }
      }
    };
    walk("apps");
    walk("packages");
    const wanted = new Map<string, string>();
    for (const path of sources) {
      const reads = read(path).matchAll(
        /env\s*\[\s*"([A-Z][A-Z0-9_]{2,})"\s*\]|\benv\.([A-Z][A-Z0-9_]{2,})\b/g,
      );
      for (const found of reads) {
        const name = found[1] ?? found[2] ?? "";
        if (name !== "" && !wanted.has(name)) wanted.set(name, path);
      }
    }
    const missingFrom = (example: string): string[] => {
      const declared = new Set([...example.matchAll(/^([A-Z][A-Z0-9_]{2,})=/gm)].map((m) => m[1]));
      return [...wanted]
        .filter(([name]) => !declared.has(name) && !PLATFORM.includes(name))
        .map(([name, path]) => `${name} is read by ${path} and is not in .env.example`);
    };

    const example = read(".env.example");

    // **The rule is asserted to still work before it is believed.** A zero from an instrument that
    // has quietly stopped matching is indistinguishable from a zero from a clean corpus, and every
    // check in this file was wrong on its first run — one of them reported 203 defects, another
    // reported none because its pattern could not match what it was looking for. So the known-bad
    // case is pinned beside the real one: `.env.example` with `CRON_SECRET=` turned back into the
    // prose mention it was before `fd06ec1`, which is the exact failure this rule exists to catch.
    const asMention = example.replace(
      /^CRON_SECRET=.*$/m,
      "# CRON_SECRET works too, which is the name Vercel injects.",
    );
    expect(asMention).not.toBe(example); // the fixture must actually differ, or it proves nothing
    expect(missingFrom(asMention).join("\n")).toContain("CRON_SECRET");

    expect(missingFrom(example).join("\n")).toBe("");
  });

  it("states beside each variable the default the code actually uses", () => {
    // The rule above demands a fillable line for every variable, and says in its own comment that
    // it never asks whether the line beside it is true. It was not. `.env.example` gave the demo's
    // latency as 0 and its desk ceilings as 200 and 3, where the code uses 2000, 500 and 10. Two
    // of those three are the figures `render.yaml` *sets* for a 512 MB box and the third matches
    // nothing at all: one deployment's settings copied into the file that documents the defaults.
    // `docs/UI.md` had all three right the whole time, which is how the document nobody deploys
    // from stays correct while the file everybody copies drifts.
    //
    // The figures are read out of the source rather than written here, so this cannot become a
    // third copy that drifts in its turn: if a literal moves, the extraction matches nothing and
    // the test says which pattern went stale instead of quietly passing.
    const literal = (path: string, pattern: RegExp): number => {
      const found = pattern.exec(read(path));
      expect(found, `${String(pattern)} no longer matches anything in ${path}`).not.toBeNull();
      return Number((found?.[1] ?? "").replace(/_/g, ""));
    };
    const CODE: Record<string, number> = {
      SLIP_DEMO_LATENCY_MS: literal("apps/web/src/server/demo/timing.ts", /latencyMs:\s*([\d_]+)/),
      SLIP_DEMO_MAX_DESKS: literal(
        "apps/web/src/server/runtime.ts",
        /positiveInt\(env\["SLIP_DEMO_MAX_DESKS"\],\s*([\d_]+)\)/,
      ),
      SLIP_DEMO_DESKS_PER_ADDRESS: literal(
        "apps/web/src/server/runtime.ts",
        /positiveInt\(env\["SLIP_DEMO_DESKS_PER_ADDRESS"\],\s*([\d_]+)\)/,
      ),
    };

    // A block is a run of comment lines together with the variables it introduces. Only blocks
    // that state a default in figures are checked, so documenting one is never made compulsory:
    // a rule that demanded a figure everywhere would cry wolf over every variable whose default
    // is "unset", which is most of them.
    const wrong = (example: string): string[] => {
      const blocks: { comment: string; names: string[] }[] = [];
      let comment: string[] = [];
      let names: string[] = [];
      const flush = (): void => {
        if (names.length > 0) blocks.push({ comment: comment.join(" "), names });
        comment = [];
        names = [];
      };
      for (const line of example.split("\n")) {
        if (line.startsWith("#")) {
          if (names.length > 0) flush();
          comment.push(line);
        } else if (/^[A-Z][A-Z0-9_]{2,}=/.test(line)) {
          names.push(/^([A-Z][A-Z0-9_]{2,})=/.exec(line)?.[1] ?? "");
        } else {
          flush();
        }
      }
      flush();

      const found: string[] = [];
      for (const block of blocks) {
        const stated = /\bDefaults?\s+(\d+(?:\s+and\s+\d+)*)/.exec(block.comment);
        if (stated === null) continue;
        const figures = [...(stated[1] ?? "").matchAll(/\d+/g)].map((m) => Number(m[0]));
        const named = block.names.filter((name) => CODE[name] !== undefined);
        if (named.length === 0) continue;
        if (figures.length !== block.names.length) {
          found.push(
            `"${stated[0]}" states ${figures.length} figures for ${block.names.length} variables (${block.names.join(", ")})`,
          );
          continue;
        }
        for (const [index, name] of block.names.entries()) {
          const code = CODE[name];
          if (code !== undefined && code !== figures[index]) {
            found.push(
              `.env.example says ${name} defaults to ${figures[index]}, the code uses ${code}`,
            );
          }
        }
      }
      return found;
    };

    const example = read(".env.example");

    // **Calibrated against the known-bad case before it is believed**, like the rule above: the
    // three figures as they actually stood, put back. A sweep that reports nothing has proved
    // nothing until it has been made to report something.
    const asDrifted = example
      .replace(/# Default \d+, which is what makes/, "# Default 0, which is what makes")
      .replace(/# Defaults \d+ and \d+\. A seeded desk/, "# Defaults 200 and 3. A seeded desk");
    expect(asDrifted).not.toBe(example); // the fixture must differ, or it proves nothing
    expect(wrong(asDrifted)).toHaveLength(3);
    expect(wrong(asDrifted).join("\n")).toContain("SLIP_DEMO_LATENCY_MS");

    expect(wrong(example).join("\n")).toBe("");
  });

  /**
   * **`CRON_SECRET`, not `SLIP_CRON_SECRET`, wherever a document tells a serverless deployment
   * what to set.**
   *
   * `cronSecrets()` accepts either name, which is what makes them look interchangeable in prose.
   * They are not. Vercel's scheduler sends a bearer token only for a variable named exactly
   * `CRON_SECRET`, so a deployment that followed a document naming Slip's own name instead answers
   * 401 to its own cron for ever — and that looks like nothing at all until an authorization has
   * been sitting on a real card for a week (D76). `services.ts` refuses a live boot over it and
   * `.env.example` warns about it in bold; three living documents told the operator the opposite
   * anyway, one of them in a go-live checklist.
   *
   * Why those three outlived two corrections is why this is a rule rather than three edits. D76
   * swept the sentences that named `CRON_SECRET`; D105 swept the ones that named "Hobby" or
   * "daily". None of the three says any of those words, so each sweep for the newly-correct
   * condition passed straight over the stale claim. A rule that matches the trap itself does not
   * care what words surround it.
   */
  it("offers the cron secret Vercel sends wherever it offers Slip's own", () => {
    // `_` is a word character, so `\bCRON_SECRET\b` cannot match inside `SLIP_CRON_SECRET`. The
    // whole rule rests on that, so it is proven here rather than assumed.
    expect(/\bCRON_SECRET\b/.test("SLIP_CRON_SECRET")).toBe(false);
    expect(/\bCRON_SECRET\b/.test("set CRON_SECRET to a generated secret")).toBe(true);

    const trapped = (docs: readonly (readonly [string, string])[]): string[] =>
      docs.flatMap(([path, text]) =>
        units(text)
          .filter((unit) => unit.includes("SLIP_CRON_SECRET") && !/\bCRON_SECRET\b/.test(unit))
          .map((unit) => `${path} offers only SLIP_CRON_SECRET — ${unit.slice(0, 80)}`),
      );

    const docs = LIVING.map((path): readonly [string, string] => [path, read(path)]);

    // **Calibrated against the known-bad case before it is believed**, like every rule here — and
    // the known-bad case is the real one: the README's live-suites paragraph exactly as it stood
    // before this rule existed, with the platform's name taken back out and Slip's own left behind.
    const trap = (text: string): string =>
      text.replace(
        /needs `CRON_SECRET` — the\s+name Vercel's scheduler sends, with Slip's own `SLIP_CRON_SECRET` accepted too —/,
        "needs `SLIP_CRON_SECRET`,",
      );
    const asTrap = docs.map((entry): readonly [string, string] =>
      entry[0] === "README.md" ? [entry[0], trap(entry[1])] : entry,
    );
    // Found by name, not by position: a reordered `LIVING` must not quietly compare two documents
    // that were both left alone.
    const readmeText = read("README.md");
    expect(trap(readmeText)).not.toBe(readmeText); // the fixture must differ, or it proves nothing
    expect(trapped(asTrap).join("\n")).toContain("README.md");

    expect(trapped(docs).join("\n")).toBe("");
  });

  /**
   * **One cadence, written down once.** The README stated the serverless resolver's schedule in
   * two places and they disagreed: the deployment passage said "every few minutes, and a daily
   * sweep will not do" and named the Hobby cap, while the feature list a hundred lines later said
   * it runs "every five minutes" — which the committed `apps/web/vercel.json` has never done.
   * D105 corrected the first and left the second, and the ledger then recorded the passage as
   * fixed. `config.ts` already reasons this way about `reconcileEveryMs` ("the stored 'as of' is
   * what decides when to look again, so this is the only place the cadence is written down"); the
   * second copy is what drifted, so the fix was to delete it rather than correct it.
   *
   * **What this rule does not do**, because a guard that reads stronger than it is costs more than
   * no guard: it cannot tell a true cadence from a false one, so one wrong sentence still passes.
   * It catches the *second* sentence, whatever figure that one states. The credential rule above
   * is the one that would have caught all three of this commit's defects.
   */
  it("states the serverless resolver's cadence in exactly one place", () => {
    const crons = JSON.parse(read("apps/web/vercel.json")).crons as { schedule: string }[];
    const schedule = crons[0]?.schedule ?? "";
    expect(schedule, "apps/web/vercel.json no longer declares a cron for the resolver").not.toBe(
      "",
    );

    const CADENCE =
      /every (?:few|five|\d+) minutes|once a day|\bdaily\b|(?:\*|\d+)(?:\/\d+)? \d+ \* \* \*/;
    const stating = (text: string): string[] =>
      units(text).filter((unit) => unit.includes("/api/cron/resolve") && CADENCE.test(unit));

    const readme = read("README.md");

    // The known-bad case is again the real one: the cadence this commit deleted, put back.
    const asDuplicated = readme.replace(
      "`/api/cron/resolve` on a schedule — set up where running the real thing is described above.",
      "`/api/cron/resolve` every five minutes, authorised by `SLIP_CRON_SECRET`.",
    );
    expect(asDuplicated).not.toBe(readme); // the fixture must differ, or it proves nothing
    expect(stating(asDuplicated)).toHaveLength(2);

    expect(
      stating(readme),
      `the committed schedule is "${schedule}", and README.md should state a cadence for the route in one place only`,
    ).toHaveLength(1);
  });
});
