"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type LimitsInput, type LimitsResult, saveLimits } from "../app/actions/limits";
import { answerOf } from "./answer";

/**
 * The limits, as blanks on a numbered form. Each one says which decision it makes, in the owner's
 * own units — percent and dollars, not hundredths and cents. Saving issues the next version;
 * what the new limits do to a worked purchase is printed by the server, from the rules
 * themselves, when the page re-reads.
 */
export function LimitsForm({ version, initial }: { version: number; initial: LimitsInput }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [result, setResult] = useState<LimitsResult | null>(null);
  const [busy, setBusy] = useState(false);
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
        setBusy(true);
        setResult(null);
        void answerOf(saveLimits(values, version)).then((answer) => {
          setBusy(false);
          setResult(answer);
          if (answer.status === "updated") {
            router.refresh();
          }
        });
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
              ? "Slip could not tell whether that saved. Reload the page to see which version is in force."
              : result.message}
        </p>
      )}
    </form>
  );
}
