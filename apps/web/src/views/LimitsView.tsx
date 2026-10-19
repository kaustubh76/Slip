"use client";

import { formatPct, formatUsd, type Policy } from "@slip/domain";
import { Leaders, LimitsPicture, LiveBadge, usePolicies } from "@slip/ui";
import { useState } from "react";
import { LimitsForm } from "../components/LimitsForm";
import { ErrorSlip, FeedingPaper } from "../components/Slips";
import {
  capSentence,
  EXAMPLE_BEST,
  EXAMPLE_CHOSEN,
  type LimitsDraft,
  policyFrom,
  workedExample,
} from "../lib/limits-example";

/**
 * The owner's limits, live: the form that issues the next version beside a picture of what those
 * numbers would do, then every version so far. The picture follows the form as it is typed in, so
 * the owner sees the effect of a limit before issuing it — and it is drawn and decided by the
 * rules themselves, so it cannot promise something a real purchase would not do.
 */
export function LimitsView(props: { token: string }) {
  const policies = usePolicies();
  const [draft, setDraft] = useState<LimitsDraft | null>(null);
  const [trial, setTrial] = useState({
    chosen: EXAMPLE_CHOSEN / 100,
    best: EXAMPLE_BEST / 100,
  });
  const versions = policies.data ?? [];
  const current = versions[0];
  if (current === undefined) {
    return policies.isError ? (
      <ErrorSlip
        what="your limits"
        error={policies.error}
        onRetry={() => void policies.refetch()}
      />
    ) : (
      <FeedingPaper label="Policy" />
    );
  }
  // The wire carries plain numbers; the rules take the same numbers.
  const policy = current as Policy;
  const example = workedExample(policy);
  // What the form holds right now, falling back to the version in force before anything is typed.
  const drafted = draft === null ? policy : policyFrom(draft);
  const trialExample = workedExample(drafted, {
    chosenCents: Math.round(trial.chosen * 100),
    bestCents: Math.round(trial.best * 100),
  });
  return (
    <>
      <div className="slip-twoup">
        <article className="slip-sheet" data-perforated="">
          <header className="slip-roll-head">
            <p className="slip-meta">Policy · version {current.version} · in force</p>
            <LiveBadge initialToken={props.token} />
          </header>
          <h1 className="slip-title">What your agents may do</h1>
          <p className="slip-sentence" data-slip-outcome={example.outcome}>
            {example.sentence}
          </p>
          <p className="slip-caption">{capSentence(policy)}</p>
          <hr className="slip-rule" />
          <LimitsForm
            key={current.version}
            version={current.version}
            initial={{
              maxOverpayPct: current.maxOverpayPctHundredths / 100,
              maxOverpayDollars: current.maxOverpayAbsCents / 100,
              flagPct: current.flagPctHundredths / 100,
              orderCapDollars: current.orderCapCents / 100,
              snapshotMaxAgeMinutes: Math.round(current.snapshotMaxAgeMs / 60_000),
            }}
            onDraft={setDraft}
          />
        </article>
        <section className="slip-sheet" aria-label="What these limits would do">
          <p className="slip-meta">Try a purchase</p>
          <p className="slip-prose">
            Change either price, or the limits beside this, and watch what Slip would decide. The
            rules themselves answer; nothing is charged and nothing is saved here.
          </p>
          <div className="slip-fields">
            <div className="slip-field">
              <label className="slip-field-label" htmlFor="try-chosen">
                Your agent pays
              </label>
              <input
                id="try-chosen"
                className="slip-blank"
                type="number"
                min="0.01"
                step="0.01"
                value={String(trial.chosen)}
                onChange={(event) =>
                  setTrial({ ...trial, chosen: Number.parseFloat(event.target.value || "0") })
                }
              />
            </div>
            <div className="slip-field">
              <label className="slip-field-label" htmlFor="try-best">
                Lowest listed
              </label>
              <input
                id="try-best"
                className="slip-blank"
                type="number"
                min="0.01"
                step="0.01"
                value={String(trial.best)}
                onChange={(event) =>
                  setTrial({ ...trial, best: Number.parseFloat(event.target.value || "0") })
                }
              />
            </div>
          </div>
          <LimitsPicture
            policy={drafted}
            bestCents={Math.round(trial.best * 100)}
            chosenCents={Math.round(trial.chosen * 100)}
            outcome={trialExample.outcome}
            sentence={trialExample.sentence}
          />
        </section>
      </div>
      <article className="slip-sheet">
        <p className="slip-meta">Every version</p>
        {versions.map((version) => (
          <section key={version.version}>
            <p className="slip-meta">
              Version {version.version}
              {version.version === current.version ? " · in force" : ""}
            </p>
            <Leaders
              rows={[
                [
                  "Reject above",
                  `${formatPct(version.maxOverpayPctHundredths)} and ${formatUsd(version.maxOverpayAbsCents as Policy["maxOverpayAbsCents"])}`,
                ],
                ["Look closer above", formatPct(version.flagPctHundredths)],
                ["Hold orders above", formatUsd(version.orderCapCents as Policy["orderCapCents"])],
                ["Prices stale after", `${Math.round(version.snapshotMaxAgeMs / 60_000)} min`],
              ]}
            />
          </section>
        ))}
        <p className="slip-caption">
          Past decisions keep the version they were checked under, so a receipt always says what the
          limits were at the time.
        </p>
      </article>
    </>
  );
}
