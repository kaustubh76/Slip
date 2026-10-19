"use client";

import type { Outcome } from "@slip/domain";
import type { OutcomeCounts } from "../rollView.js";

const CHOICES: readonly (readonly [Outcome, string])[] = [
  ["PAID", "Paid"],
  ["REJECTED", "Rejected"],
  ["HELD", "Held"],
];

/**
 * Narrows the roll to one kind of outcome. It filters the receipts already on the roll rather
 * than asking for more, so the counts beside each word are the loaded ones and the caption says
 * what is being narrowed — an owner should never read these as the totals above.
 *
 * Buttons, not a menu: the one menu on this screen is the agent filter, which the keyboard
 * reaches with `/`.
 */
export function OutcomeFilter(props: {
  value: Outcome | null;
  counts: OutcomeCounts;
  onChange: (next: Outcome | null) => void;
}) {
  const total = props.counts.PAID + props.counts.REJECTED + props.counts.HELD;
  return (
    <section className="slip-filters" aria-label="Narrow the roll">
      <p className="slip-meta">On this roll</p>
      <div className="slip-filter-row">
        <button
          type="button"
          className="slip-filter"
          aria-pressed={props.value === null}
          onClick={() => props.onChange(null)}
        >
          All <span className="slip-filter-count">{total}</span>
        </button>
        {CHOICES.map(([outcome, label]) => (
          <button
            key={outcome}
            type="button"
            className="slip-filter"
            data-outcome={outcome}
            aria-pressed={props.value === outcome}
            disabled={props.counts[outcome] === 0 && props.value !== outcome}
            onClick={() => props.onChange(props.value === outcome ? null : outcome)}
          >
            {label} <span className="slip-filter-count">{props.counts[outcome]}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
