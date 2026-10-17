import type { Measure } from "@slip/receipt";

const MID = 20;

/**
 * How far apart (on the 0–1000 scale) two labels under the line must be to be read apart at phone
 * width. A label too close to one already placed is left out; the caption still says its value.
 */
const LABEL_GAP = 180;

interface ScaleLabel {
  key: string;
  x: number;
  text: string;
}

/**
 * The labels under the line, most important first: the agent's choice, the lowest price, then the
 * limit. One that would overlap a label already placed is dropped — when the choice *is* the
 * lowest price, its value is printed once, not twice on top of itself.
 */
export function placeLabels(candidates: readonly ScaleLabel[]): ScaleLabel[] {
  const placed: ScaleLabel[] = [];
  for (const label of candidates) {
    if (placed.every((p) => Math.abs(p.x - label.x) >= LABEL_GAP)) {
      placed.push(label);
    }
  }
  return placed.sort((a, b) => a.x - b.x);
}

/** Labels near an end are aligned to it, so none spills past the slip. */
function alignOf(x: number, width: number): "start" | "center" | "end" {
  return x < width * 0.1 ? "start" : x > width * 0.9 ? "end" : "center";
}

function Label({ label, width }: { label: ScaleLabel; width: number }) {
  return (
    <span
      data-align={alignOf(label.x, width)}
      style={{ insetInlineStart: `${(label.x / width) * 100}%` }}
    >
      {label.text}
    </span>
  );
}

/**
 * The gap scale: the lowest listed price at the left, the stretch within the owner's limits as a
 * solid rule, the agent's choice as an `x`, other comparable offers as ticks, the order cap dashed.
 * The drawing is decoration; the caption beneath says all of it in words.
 */
export function GapScale({ measure }: { measure: Measure }) {
  const { low, limit, chosen, cap, ticks } = measure;
  const past = chosen.x > limit.x;
  const labels = placeLabels([
    { key: "chosen", x: chosen.x, text: chosen.label },
    { key: "low", x: low.x, text: low.label },
    { key: "limit", x: limit.x, text: limit.label },
  ]);
  return (
    <figure className="slip-scale-figure">
      {cap === null ? null : (
        // Above the line, where it cannot collide with the prices beneath.
        <div className="slip-scale-labels" data-row="top" aria-hidden="true">
          <Label
            label={{ key: "cap", x: cap.x, text: `order cap ${cap.label}` }}
            width={measure.width}
          />
        </div>
      )}
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
        {labels.map((label) => (
          <Label key={label.key} label={label} width={measure.width} />
        ))}
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
