/**
 * A rubber stamp: the verdict in ink and in shape — PAID solid, REJECTED double, HELD dashed, and
 * grey for what was let go (VOID: revoked, expired, released). Readable in greyscale.
 */
export type StampKind = "PAID" | "REJECTED" | "HELD" | "VOID";

export function Stamp(props: {
  kind: StampKind;
  /** The word on the stamp; the kind by default. */
  label?: string;
  size?: "row" | "large";
  /** Only the receipt detail tilts its stamp. */
  rotated?: boolean;
  /** Presses once as it appears (a slip just printed). */
  pressed?: boolean;
}) {
  const label = props.label ?? props.kind;
  return (
    <span
      className="slip-stamp"
      data-outcome={props.kind}
      data-size={props.size === "large" ? "large" : undefined}
      data-rotated={props.rotated ? "" : undefined}
      data-pressed={props.pressed ? "" : undefined}
      role="img"
      aria-label={`Outcome: ${label.toLowerCase()}`}
    >
      {label}
    </span>
  );
}
