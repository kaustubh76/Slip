import type { Measure } from "@slip/receipt";

const MID = 20;

/**
 * The gap scale: the lowest listed price at the left, the stretch within the owner's limits as a
 * solid rule, the agent's choice as an `x`, other comparable offers as ticks, the order cap dashed.
 * The drawing is decoration; the caption beneath says all of it in words.
 */
export function GapScale({ measure }: { measure: Measure }) {
  const { low, limit, chosen, cap, ticks } = measure;
  const past = chosen.x > limit.x;
  return (
    <figure className="slip-scale-figure">
      <svg
        className="slip-scale"
        viewBox={`0 0 ${measure.width} 40`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <line className="slip-scale-band" x1={low.x} x2={limit.x} y1={MID} y2={MID} />
        {past ? (
          <line className="slip-scale-beyond" x1={limit.x} x2={chosen.x} y1={MID} y2={MID} />
        ) : null}
        <line className="slip-scale-tick" x1={limit.x} x2={limit.x} y1={8} y2={32} />
        {ticks.map((tick) => (
          <line
            key={`${tick.cents}-${tick.x}`}
            className="slip-scale-tick"
            x1={tick.x}
            x2={tick.x}
            y1={14}
            y2={26}
          />
        ))}
        {cap === null ? null : (
          <line className="slip-scale-cap" x1={cap.x} x2={cap.x} y1={4} y2={36} />
        )}
        <g className="slip-scale-chosen" data-chosen-x={chosen.x}>
          <line x1={chosen.x - 8} x2={chosen.x + 8} y1={MID - 8} y2={MID + 8} />
          <line x1={chosen.x - 8} x2={chosen.x + 8} y1={MID + 8} y2={MID - 8} />
        </g>
      </svg>
      <div className="slip-scale-labels" aria-hidden="true">
        <span style={{ insetInlineStart: `${low.x / 10}%` }}>{low.label}</span>
        <span style={{ insetInlineStart: `${limit.x / 10}%` }}>{limit.label}</span>
        <span style={{ insetInlineStart: `${chosen.x / 10}%` }}>{chosen.label}</span>
      </div>
      <figcaption className="slip-caption">
        {measure.caption}
        {measure.pastLimit === null ? null : (
          <>
            {" "}
            <strong>{measure.pastLimit}.</strong>
          </>
        )}
      </figcaption>
    </figure>
  );
}
