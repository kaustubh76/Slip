import { policyVersions } from "@slip/app";
import { formatPct, formatUsd } from "@slip/domain";
import { Leaders } from "@slip/ui";
import { notFound } from "next/navigation";
import { LimitsForm } from "../../components/LimitsForm";
import { capSentence, workedExample } from "../../server/limits-example";
import { requireOwner } from "../../server/owner";

export const dynamic = "force-dynamic";

/** The owner's limits: the form that issues the next version, then every version so far. */
export default async function Limits() {
  const { ownerId, mandateId, deps } = await requireOwner();
  const versions = await policyVersions(deps, ownerId, mandateId);
  const current = versions?.[0];
  if (versions === undefined || versions === null || current === undefined) {
    notFound();
  }
  const example = workedExample(current);
  return (
    <>
      <article className="slip-sheet" data-perforated="">
        <p className="slip-meta">Policy · version {current.version} · in force</p>
        <h1 className="slip-title">What your agents may do</h1>
        <p className="slip-sentence" data-slip-outcome={example.outcome}>
          {example.sentence}
        </p>
        <p className="slip-caption">{capSentence(current)}</p>
        <hr className="slip-rule" />
        <LimitsForm
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
        {versions.map((policy) => (
          <section key={policy.version}>
            <p className="slip-meta">
              Version {policy.version}
              {policy.version === current.version ? " · in force" : ""}
            </p>
            <Leaders
              rows={[
                [
                  "Reject above",
                  `${formatPct(policy.maxOverpayPctHundredths)} and ${formatUsd(policy.maxOverpayAbsCents)}`,
                ],
                ["Look closer above", formatPct(policy.flagPctHundredths)],
                ["Hold orders above", formatUsd(policy.orderCapCents)],
                ["Prices stale after", `${Math.round(policy.snapshotMaxAgeMs / 60_000)} min`],
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
