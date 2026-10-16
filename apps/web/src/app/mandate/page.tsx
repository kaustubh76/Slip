import { mandateSummary, policyVersions } from "@slip/app";
import { formatPct, formatUsd } from "@slip/domain";
import { Leaders, printedAt, Stamp } from "@slip/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BeginSetup } from "../../components/BeginSetup";
import { KillSwitch } from "../../components/KillSwitch";
import { requireOwner } from "../../server/owner";

export const dynamic = "force-dynamic";

const SETUP_NOTES: Record<string, string> = {
  active: "PayPal has saved your payment method. Slip can now pay within your limits.",
  pending:
    "PayPal has your approval but has not issued the payment method yet. Slip keeps asking; this page will say so once it has.",
  "not-approved":
    "PayPal has not recorded an approval for this setup. You can send it again below.",
  cancelled: "Nothing was saved at PayPal, so there is nothing to undo.",
  setup_failed: "PayPal could not confirm the saved payment method. You can try again below.",
  revoked: "This permission was cancelled. Start a new one below.",
  not_found: "That setup does not belong to this account.",
};

/**
 * The permission slip: what the owner allowed, which limits are in force, and — at its foot, as a
 * tear-off — the one control that stops everything.
 */
export default async function Mandate({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const { ownerId, mandateId, deps } = await requireOwner();
  const [summary, versions, { setup }] = await Promise.all([
    mandateSummary(deps, ownerId, mandateId),
    policyVersions(deps, ownerId, mandateId),
    searchParams,
  ]);
  const current = versions?.[0];
  if (summary === null || current === undefined) {
    notFound();
  }
  const note = setup === undefined ? undefined : SETUP_NOTES[setup];
  return (
    <article className="slip-sheet" data-perforated="">
      <header className="slip-receipt-head">
        <p className="slip-meta">Permission slip · no. {summary.id.slice(0, 8)}</p>
        {summary.status === "REVOKED" ? (
          <Stamp kind="VOID" label="CANCELLED" describedAs="This permission was cancelled" />
        ) : summary.status === "ACTIVE" ? (
          <Stamp kind="VOID" label="IN FORCE" describedAs="This permission is in force" />
        ) : (
          <Stamp
            kind="HELD"
            label="AWAITING PAYPAL"
            describedAs="This permission is waiting for PayPal"
          />
        )}
      </header>
      <hr className="slip-rule" />
      <p className="slip-sentence">
        I allow agents under this permission to pay through Slip, within these limits:
      </p>
      <Leaders
        rows={[
          [
            "Reject above",
            `${formatPct(current.maxOverpayPctHundredths)} and ${formatUsd(current.maxOverpayAbsCents)}`,
          ],
          ["Hold orders above", formatUsd(current.orderCapCents)],
          ["Limits version", `${current.version}`],
          ["Agents", `${summary.agents}`],
          ["Waiting for you", `${summary.pendingHolds}`],
          ["Signed", summary.activatedAt === null ? "not yet" : printedAt(summary.activatedAt)],
          ...(summary.revokedAt === null
            ? []
            : ([["Cancelled", printedAt(summary.revokedAt)]] as const)),
        ]}
      />
      <p className="slip-caption">
        <Link href="/limits" className="slip-link">
          Change the limits →
        </Link>
      </p>
      {note === undefined ? null : (
        <p className="slip-note slip-pen" role="status">
          {note}
        </p>
      )}
      {summary.status === "PENDING" ? (
        <>
          <hr className="slip-rule" />
          <p className="slip-prose">
            {summary.awaitingPayPal
              ? "Slip has asked PayPal to save your payment method. Approve it at PayPal, and this slip comes into force."
              : "Approve this at PayPal once, and Slip can pay within your limits without asking again."}
          </p>
          <BeginSetup
            label={summary.awaitingPayPal ? "Sign with PayPal again →" : "Sign with PayPal →"}
          />
        </>
      ) : null}
      {summary.status === "ACTIVE" ? (
        <>
          <hr className="slip-tear" />
          <KillSwitch pendingHolds={summary.pendingHolds} />
        </>
      ) : null}
      {summary.status === "REVOKED" ? (
        <>
          <hr className="slip-rule" />
          <p className="slip-prose">
            This permission was cancelled
            {summary.savedMethodDeletedAt === null
              ? "; Slip is still waiting for PayPal to confirm the saved method was deleted."
              : ", and PayPal confirmed the saved payment method was deleted."}{" "}
            Your receipts stay.
          </p>
          <BeginSetup label="Start a new permission →" />
        </>
      ) : null}
    </article>
  );
}
