import type { Outcome, Policy } from "@slip/domain";
import { measureFor } from "@slip/receipt";
import { GapScale } from "./GapScale.js";

/**
 * What a set of limits would do to one purchase, drawn. The scale is the same one a receipt
 * carries and is built by the same function, and the verdict beside it is decided by the rules
 * themselves — so nothing here can say one thing while a real purchase does another.
 *
 * The host supplies both: it owns the draft being edited, and it runs the rules.
 */
export function LimitsPicture(props: {
  policy: Policy;
  bestCents: number;
  chosenCents: number;
  outcome: Outcome;
  sentence: string;
}) {
  const measure = measureFor(
    {
      bestCents: props.bestCents,
      chosenCents: props.chosenCents,
      capCents: props.outcome === "HELD" ? props.policy.orderCapCents : null,
    },
    props.policy,
  );
  return (
    <div className="slip-picture">
      <GapScale measure={measure} />
      <p className="slip-sentence" data-slip-outcome={props.outcome} aria-live="polite">
        {props.sentence}
      </p>
    </div>
  );
}
