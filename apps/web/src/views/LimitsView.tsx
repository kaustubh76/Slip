"use client";

import { formatPct, formatUsd, type Policy } from "@slip/domain";
import { Leaders, LiveBadge, usePolicies } from "@slip/ui";
import { LimitsForm } from "../components/LimitsForm";
import { ErrorSlip, FeedingPaper } from "../components/Slips";
import { capSentence, workedExample } from "../lib/limits-example";

/** The owner's limits, live: the form that issues the next version, then every version so far. */
export function LimitsView(props: { token: string }) {
  const policies = usePolicies();
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
  return (
    <>
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
        />
      </article>
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
