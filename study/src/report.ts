import { formatPct, formatUsd } from "@slip/domain";
import type { ProductMeasure, StudyNumbers } from "./measure.js";
import { G1_SHARE_PCT_HUNDREDTHS } from "./measure.js";
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
    `| Widest gap seen | ${pct(numbers.widestGapPctHundredths)} |`,
    `| Dearer offer pays more commission | **${pct(numbers.commissionConflictPctHundredths)}**` +
      ` (${numbers.commissionConflicts} of ${numbers.commissionConsidered} comparable) |`,
    "",
    `Products with at least one comparable offer: ${numbers.priced} of ${numbers.products}.` +
      " The rest cannot be checked at all — nothing in them is in stock, new and priced in USD.",
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

  lines.push(
    "",
    "## What was searched",
    "",
    "| Query | Products |",
    "|---|---|",
    ...manifest.queries.map((query) => `| ${query.query} | ${query.products} |`),
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
