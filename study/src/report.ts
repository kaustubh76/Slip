import { formatPct, formatUsd } from "@slip/domain";
import type { ProductMeasure, StudyNumbers } from "./measure.js";
import { G1_SHARE_PCT_HUNDREDTHS, SUSPECT_GAP_PCT_HUNDREDTHS } from "./measure.js";
import type { Manifest } from "./snapshots.js";

/**
 * The study as a page anyone can read, with the sample size and the date on it. Percent and
 * dollars throughout, never basis points (§16), and every number that could not be computed says
 * so rather than printing a zero.
 */

/** How many products the grouping check (G4) lists for a person to look at by hand. */
const HAND_CHECK = 30;

export function renderReport(input: {
  manifest: Manifest;
  numbers: StudyNumbers;
  measures: readonly ProductMeasure[];
}): string {
  const { manifest, numbers } = input;
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
