"use client";

import type { Policy } from "@slip/domain";
import { type LimitsInput, useUpdateLimits } from "@slip/ui";
import { useState } from "react";
import { workedExample } from "../lib/limits-example";

/**
 * The limits, as blanks on a numbered form. Each one says which decision it makes, in the owner's
 * own units — percent and dollars, not hundredths and cents. As the owner types, a worked purchase
 * says what the new limits would do to it, decided by the rules themselves. Saving issues the
 * next version, based on the version this form was showing, so a tab left open cannot overwrite a
 * newer one.
 */
export function LimitsForm({ version, initial }: { version: number; initial: LimitsInput }) {
  const [values, setValues] = useState(initial);
  const { save, status, answer: result } = useUpdateLimits();
  const busy = status === "busy";
  const example = exampleFor(values);
  const changed = (Object.keys(initial) as (keyof LimitsInput)[]).some(
    (key) => values[key] !== initial[key],
  );

  const field = (key: keyof LimitsInput, label: string, help: string, step: string) => (
    <div className="slip-field" key={key}>
      <label htmlFor={`limit-${key}`} className="slip-field-label">
        {label}
      </label>
      <input
        id={`limit-${key}`}
        className="slip-blank"
        type="number"
        min="0"
        step={step}
        value={String(values[key])}
        onChange={(event) =>
          setValues({ ...values, [key]: Number.parseFloat(event.target.value || "0") })
        }
      />
      <p className="slip-caption">{help}</p>
    </div>
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save(values, version);
      }}
    >
      <div className="slip-fields">
        {field(
          "maxOverpayPct",
          "Reject above",
          "Percent over the lowest listed price. A purchase is only rejected when it is over both this and the dollar allowance below.",
          "0.1",
        )}
        {field(
          "maxOverpayDollars",
          "and above",
          "Dollars over the lowest listed price. Listed prices carry no shipping, so a small difference is not worth refusing.",
          "0.01",
        )}
        {field(
          "flagPct",
          "Look closer above",
          "Percent over the lowest listed price at which Slip checks the listing for text aimed at agents, and counts a commission difference.",
          "0.1",
        )}
        {field(
          "orderCapDollars",
          "Hold any order above",
          "Dollars. Above this, a purchase waits for you however good the price is.",
          "1",
        )}
        {field(
          "snapshotMaxAgeMinutes",
          "Prices are stale after",
          "Minutes. Older than this, Slip asks Channel3 again; if it cannot, the purchase waits for you.",
          "1",
        )}
      </div>
      {example === null || !changed ? null : (
        <p
          className="slip-sentence slip-pen"
          data-slip-outcome={example.outcome}
          aria-live="polite"
        >
          {example.sentence}
        </p>
      )}
      <div className="slip-dialog-actions">
        <button
          type="submit"
          className="slip-button"
          data-variant="ink"
          disabled={busy || !changed}
          aria-busy={busy}
        >
          {busy ? `Issuing version ${version + 1}…` : `Issue version ${version + 1}`}
        </button>
        {changed ? (
          <button type="button" className="slip-button" onClick={() => setValues(initial)}>
            Put it back
          </button>
        ) : null}
      </div>
      {result === null ? null : (
        <p className="slip-note slip-pen" role="status">
          {result.status === "updated"
            ? `Version ${result.version} is in force. Decisions already made keep the version they were checked under.`
            : result.status === "unknown"
              ? "Slip could not tell whether that saved. It is checking; the version in force shows above as soon as it knows."
              : result.message}
        </p>
      )}
    </form>
  );
}

/** What these typed limits would do to the worked purchase; null while a blank is not a number. */
function exampleFor(values: LimitsInput): ReturnType<typeof workedExample> | null {
  const numbers = Object.values(values);
  if (numbers.some((n) => !Number.isFinite(n) || n < 0)) {
    return null;
  }
  return workedExample({
    version: 1,
    maxOverpayPctHundredths: Math.round(values.maxOverpayPct * 100),
    maxOverpayAbsCents: Math.round(values.maxOverpayDollars * 100),
    flagPctHundredths: Math.round(values.flagPct * 100),
    orderCapCents: Math.round(values.orderCapDollars * 100),
    snapshotMaxAgeMs: Math.round(values.snapshotMaxAgeMinutes * 60_000),
  } as Policy);
}
