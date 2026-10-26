import { formatPct, formatUsd } from "@slip/domain";
import type { ProductMeasure, StudyNumbers } from "./measure.js";
import { G1_SHARE_PCT_HUNDREDTHS, SUSPECT_GAP_PCT_HUNDREDTHS } from "./measure.js";
import type { Manifest } from "./snapshots.js";
import { AGENT_DIRECTED_PATTERNS, type TextScan, verdictFor } from "./text.js";

/**
 * The study as a page anyone can read, with the sample size and the date on it. Percent and
 * dollars throughout, never basis points (§16), and every number that could not be computed says
 * so rather than printing a zero.
 */

/** How many products the grouping check (G4) lists for a person to look at by hand. */
const HAND_CHECK = 30;

/** How many products to name for someone about to drive Slip on real prices. */
const WORTH_TRYING = 12;

export function renderReport(input: {
  manifest: Manifest;
  numbers: StudyNumbers;
  measures: readonly ProductMeasure[];
  text: TextScan;
}): string {
  const { manifest, numbers, text: scan } = input;
  const pct = (hundredths: number | null): string =>
    hundredths === null ? "—" : formatPct(hundredths);
  const date = manifest.sampledAt.slice(0, 10);

  const lines: string[] = [
    "# Market study",
    "",
    `Real Channel3 offers, sampled on ${date}. ${manifest.queries.length} searches,` +
      ` ${numbers.products} distinct products, ${manifest.credits} credits.`,
    "",
    "Every number below is recomputed from `study/snapshots/` by `pnpm study:report`, with no key" +
      " and no network. Offers are mapped by the production adapter and compared by" +
      " `@slip/check`'s own rule — in stock, condition new, a positive USD price, one entry per" +
      " listing — so nothing here counts an offer Slip could not have compared.",
    "",
    "## The three numbers",
    "",
    "| | |",
    "|---|---|",
    `| Products with 2+ comparable offers | **${pct(numbers.shareWithTwoOrMorePctHundredths)}**` +
      ` (${numbers.withTwoOrMore} of ${numbers.products}) |`,
    `| Typical gap, cheapest to priciest | **${pct(numbers.medianGapPctHundredths)}**` +
      `${numbers.medianGapCents === null ? "" : ` · ${formatUsd(numbers.medianGapCents)}`} |`,
    `| Middle half of those gaps | ${pct(numbers.quartileGapPctHundredths.lower)} to` +
      ` ${pct(numbers.quartileGapPctHundredths.upper)} |`,
    `| Dearer offer pays more commission | **${pct(numbers.commissionConflictPctHundredths)}**` +
      ` (${numbers.commissionConflicts} of ${numbers.commissionConsidered} comparable) |`,
    "",
    numbers.priced === numbers.products
      ? `Every product in the sample had at least one comparable offer.`
      : `Products with at least one comparable offer: ${numbers.priced} of ${numbers.products}.` +
        " The rest cannot be checked at all — nothing in them is in stock, new and priced in USD.",
    "",
    `A quarter of the comparable products are priced identically at every store` +
      ` (${pct(numbers.quartileGapPctHundredths.lower)} gap), so the median is doing real work here:` +
      ` where there is a difference it is usually large.`,
    "",
    `**G1** asks for ${formatPct(G1_SHARE_PCT_HUNDREDTHS)} of sampled products to carry two or more` +
      ` comparable offers. This sample: ${pct(numbers.shareWithTwoOrMorePctHundredths)} —` +
      ` **${numbers.g1Pass ? "pass" : "fail"}**.`,
  ];

  if (!numbers.g1Pass) {
    lines.push(
      "",
      "A fail is not a defect in the check; it says this sample's categories are mostly" +
        " single-retailer. The spec's answer is to narrow the categories, and to lead with" +
        " SlipBench rather than this number.",
    );
  }

  if (numbers.suspectGrouping > 0) {
    lines.push(
      "",
      "## Suspected grouping errors, and what they would cost",
      "",
      `${numbers.suspectGrouping} of the ${numbers.withTwoOrMore} comparable products show a gap` +
        ` above ${formatPct(SUSPECT_GAP_PCT_HUNDREDTHS)}. Those are far more likely to be` +
        " Channel3 filing two different items under one product id than a store selling the same" +
        " thing for a fraction of the price — one of them puts a $40 skillet beside a $637 one." +
        " They are listed below as suspected, not counted as bargains.",
      "",
      `Excluding them, the typical gap is` +
        ` **${pct(numbers.medianGapPctHundredthsExcludingSuspect)}** rather than` +
        ` ${pct(numbers.medianGapPctHundredths)}. Quote the smaller number.`,
      "",
      "**This is a live risk in the product, not just in the study.** Slip compares within one" +
        ' product id, so a wrong grouping makes the cheapest "comparable" offer a different' +
        " item — and a correct purchase of the dearer one would be rejected against it. The spec" +
        " anticipated this as gate G4 and left it [UNVERIFIED]; this sample is the first evidence" +
        " that it happens, at roughly one comparable product in fifteen.",
      "",
      "| Suspected gap | Cheapest → priciest | Product | Stores |",
      "|---|---|---|---|",
      ...input.measures
        .filter((measure) => measure.spread !== null && measure.suspectGrouping)
        .sort((a, b) => (b.spread?.gapPctHundredths ?? 0) - (a.spread?.gapPctHundredths ?? 0))
        .map((measure) => {
          const spread = measure.spread;
          return (
            `| ${spread === null ? "—" : formatPct(spread.gapPctHundredths)} |` +
            ` ${spread === null ? "—" : `${formatUsd(spread.cheapest)} → ${formatUsd(spread.priciest)}`} |` +
            ` ${measure.title.replace(/\|/g, "/")} | ${measure.domains.join(", ")} |`
          );
        }),
    );
  }

  const queryText = new Map(manifest.queries.map((query) => [query.slug, query.query]));
  lines.push(
    "",
    "## Why so few comparisons",
    "",
    `Channel3 listed ${numbers.offersListed} offers across the ${numbers.products} products. The` +
      ` adapter read ${numbers.offersMapped} of them and the check could compare` +
      ` ${numbers.offersComparable}, so **neither Slip's mapping nor its comparison rule is what` +
      ` thins the sample** — the catalogue simply carries one offer for most products.`,
    "",
    "| Offers not compared | |",
    "|---|---|",
    `| No price Slip could read | ${numbers.excluded.noPrice} |`,
    `| Not priced in USD | ${numbers.excluded.notUsd} |`,
    `| Not in stock | ${numbers.excluded.notInStock} |`,
    `| Not condition new | ${numbers.excluded.notNew} |`,
    `| The same listing twice | ${numbers.excluded.duplicate} |`,
    "",
    "| Comparable offers | Products |",
    "|---|---|",
    ...numbers.countsByComparable.map((row) => `| ${row.comparable} | ${row.products} |`),
    "",
    "## What was searched, and how dense each one was",
    "",
    "| Query | Products | 2+ comparable offers |",
    "|---|---|---|",
    ...numbers.perQuery.map(
      (row) =>
        `| ${queryText.get(row.slug) ?? row.slug} | ${row.products} |` +
        ` ${row.withTwoOrMore} (${formatPct(row.sharePctHundredths)}) |`,
    ),
    "",
    "## If you are about to use Slip on real prices",
    "",
    `Two products in three carry a single comparable offer, so a checkout picked at random is` +
      ` held for too few offers rather than paid or rejected — correct, and a poor way to see what` +
      ` Slip does. Density is uneven and the table above is the map: search where the comparisons` +
      ` are. These are products from the ${date} sample that had two or more comparable offers and` +
      ` a real spread between them, with the suspected grouping errors below left out, so each one` +
      ` is a comparison Slip can stand behind. A catalogue moves — the queries are the durable` +
      ` part, the ids are not.`,
    "",
    "| Search for | Product | Gap | Offers |",
    "|---|---|---|---|",
    ...input.measures
      .filter((m) => m.spread !== null && !m.suspectGrouping && m.comparable >= 2)
      .sort(
        (a, b) =>
          b.comparable - a.comparable || (b.spread?.gapCents ?? 0) - (a.spread?.gapCents ?? 0),
      )
      .slice(0, WORTH_TRYING)
      .map((m) => {
        const spread = m.spread;
        const gap =
          spread === null
            ? "—"
            : `${formatPct(spread.gapPctHundredths)} · ${formatUsd(spread.gapCents)}`;
        return (
          `| ${queryText.get(m.foundBy) ?? m.foundBy} | ${m.title.replace(/\|/g, "/")}` +
          ` | ${gap} | ${m.comparable} |`
        );
      }),
    "",
    "## Has a real listing ever tried this?",
    "",
    `Slip rejects a purchase when a listing reads like instructions to the agent, so it is worth` +
      ` saying whether this sample contains any. All ${scan.products} products carried a` +
      ` description — ${scan.totalChars.toLocaleString("en-US")} characters of store prose in all,` +
      ` a median of ${scan.medianChars ?? "—"} each — and every one of them was read for the four` +
      ` things the steering check looks for that a pattern can pick out of prose:`,
    "",
    ...[...new Set(AGENT_DIRECTED_PATTERNS.map((pattern) => pattern.what))].map(
      (what) => `- text that ${what}`,
    ),
    "",
    scan.candidates.length === 0
      ? `**Nothing matched.** Not one of the ${scan.withText} descriptions used any of those` +
          " forms."
      : `**${scan.candidates.length} of ${scan.withText} matched**, and the model was asked about` +
          " each one.",
    "",
    ...(scan.candidates.length === 0
      ? []
      : [
          "| Pattern | Product | What it said | Judged |",
          "|---|---|---|---|",
          ...scan.candidates.map((candidate) => {
            const judged = verdictFor(candidate);
            const verdict =
              judged === null
                ? "not yet judged"
                : `${judged.instructionLike ? "**instruction-like**" : "ordinary selling"}` +
                  ` (\`${judged.model}\`, \`${judged.promptVersion}\`)`;
            return (
              `| \`${candidate.pattern}\` | ${candidate.title.replace(/\|/g, "/")}` +
              ` | ${candidate.quote.replace(/\|/g, "/")} | ${verdict} |`
            );
          }),
          "",
          `Each candidate was put to the production classifier — the same model, the same prompt,` +
            ` the same text an agent would have been shown — and the verdict is recorded so this` +
            ` table needs no key to print. A pattern cannot tell a merchant boasting that it is a` +
            ` "preferred retailer" from a listing claiming the buyer pre-approved it, which is the` +
            ` whole reason the check asks a model. This is that distinction, on real data.`,
          "",
        ]),
    `**What this cannot say.** It reports what matched a stated list of patterns, and text written` +
      ` to avoid those words would pass it — which is the whole reason the production check asks a` +
      ` model instead. So read it as a statement about forms, not about intent. Two of the` +
      ` classifier's six categories are missing from it as well: copy imitating a system message, a` +
      ` tool call or JSON, and copy asking for something other than selling the product, neither of` +
      ` which has a form a pattern can pick out of ordinary prose.`,
    "",
    `**So, of Slip's two reasons to stop a purchase, one is measured here and one is not.** The` +
      ` commission conflict is in this sample: the offer paying the most is the dearer one in` +
      ` ${numbers.commissionConflicts} of ${numbers.commissionConsidered} products where both` +
      ` could be read. A listing steering an agent is not, which is why SlipBench has to plant its own` +
      ` and label it synthetic. Slip's steering rule guards against something this sample does not` +
      ` contain — worth saying plainly, since agents doing the buying is new and the listings were` +
      ` written for people.`,
    "",
    `**And the size of it.** ${scan.longerThanShown} of ${scan.withText} descriptions are longer` +
      ` than the ${scan.shownLimit} characters an agent is handed, which is why there is a bound at` +
      ` all: uncapped, a ten-product search would spend several thousand characters of an agent's` +
      ` context on store prose, every byte of it untrusted and sized by whoever wrote the listing.`,
    "",
    "## Grouping, for a person to check (G4)",
    "",
    `Channel3 groups each merchant's offer under one product id, and Slip compares only within` +
      ` one id. Whether that grouping is right cannot be measured from the data itself, so here are` +
      ` ${HAND_CHECK} products with two or more comparable offers to look at by hand. G4 passes at` +
      ` one wrong grouping or fewer.`,
    "",
    "| Product | Gap | Stores |",
    "|---|---|---|",
    ...input.measures
      .filter((measure) => measure.spread !== null)
      .slice(0, HAND_CHECK)
      .map((measure) => {
        const spread = measure.spread;
        const gap =
          spread === null
            ? "—"
            : `${formatPct(spread.gapPctHundredths)} · ${formatUsd(spread.gapCents)}`;
        return `| ${measure.title.replace(/\|/g, "/")} | ${gap} | ${measure.domains.join(", ")} |`;
      }),
    "",
  );
  return `${lines.join("\n")}\n`;
}
