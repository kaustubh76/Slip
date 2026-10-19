/**
 * What became of everything an agent tried, as one bar: paid, rejected and held in the stamps'
 * own inks, each segment as wide as its share. It is a picture of numbers that are written out
 * directly beneath it, so it carries nothing of its own and is hidden from assistive tech — the
 * same bargain the gap scale makes.
 */
export function OutcomeBar(props: { paid: number; rejected: number; held: number }) {
  const total = props.paid + props.rejected + props.held;
  if (total === 0) {
    return null;
  }
  const parts = [
    ["PAID", props.paid],
    ["REJECTED", props.rejected],
    ["HELD", props.held],
  ] as const;
  return (
    <div className="slip-outcomes" aria-hidden="true">
      {parts
        .filter(([, count]) => count > 0)
        .map(([outcome, count]) => (
          <span
            key={outcome}
            className="slip-outcome-part"
            data-outcome={outcome}
            style={{ inlineSize: `${((count / total) * 100).toFixed(1)}%` }}
          />
        ))}
    </div>
  );
}
