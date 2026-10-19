import type { RollTotals } from "../rollView.js";
import { Leaders } from "./Leaders.js";

/**
 * What the agents under this permission have done, counted by the server over every attempt it
 * ever recorded — not over the few pages the roll happens to be showing. The heading says so,
 * because the filter below it narrows something else entirely.
 */
export function RollSummary({ totals }: { totals: RollTotals }) {
  if (totals.attempted === 0) {
    return (
      <section className="slip-summary" aria-label="What your agents have done">
        <p className="slip-meta">All time</p>
        <p className="slip-caption">Nothing checked yet.</p>
      </section>
    );
  }
  const rows: (readonly [string, string])[] = [
    ["Checked", String(totals.attempted)],
    ["Paid", String(totals.paid)],
    ["Rejected", String(totals.rejected)],
    ["Held for you", String(totals.held)],
  ];
  if (totals.notCheapest > 0) {
    rows.push(["Not the cheapest", String(totals.notCheapest)]);
  }
  if (totals.steered > 0) {
    rows.push(["Steered listings", String(totals.steered)]);
  }
  return (
    <section className="slip-summary" aria-label="What your agents have done">
      <p className="slip-meta">All time</p>
      <Leaders rows={rows} />
    </section>
  );
}
