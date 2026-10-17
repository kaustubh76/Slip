"use client";

import { formatPct, formatUsd, type Policy } from "@slip/domain";
import {
  Leaders,
  LiveBadge,
  printedAt,
  type RevokeMandateAnswer,
  Stamp,
  useMandate,
  usePolicies,
} from "@slip/ui";
import Link from "next/link";
import { useState } from "react";
import { BeginSetup } from "../components/BeginSetup";
import { KillSwitch, RevokeSummary } from "../components/KillSwitch";
import { ErrorSlip, FeedingPaper } from "../components/Slips";

type Revoked = Extract<RevokeMandateAnswer, { status: "revoked" }>;

/**
 * The permission slip, live: what the owner allowed, which limits are in force, and — at its foot,
 * as a tear-off — the one control that stops everything. It flips to "in force" the moment PayPal
 * confirms the saved method, and to "cancelled" the moment the kill switch is pulled.
 */
export function MandateView(props: { token: string; note: string | null }) {
  const mandate = useMandate();
  const policies = usePolicies();
  const [revoked, setRevoked] = useState<Revoked | null>(null);
  const summary = mandate.data;
  const current = policies.data?.[0];
  if (summary === undefined || current === undefined) {
    return mandate.isError || policies.isError ? (
      <ErrorSlip what="the permission slip" error={mandate.error ?? policies.error} />
    ) : (
      <FeedingPaper label="Permission slip" />
    );
  }
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
        <LiveBadge initialToken={props.token} />
      </header>
      <hr className="slip-rule" />
      <p className="slip-sentence">
        I allow agents under this permission to pay through Slip, within these limits:
      </p>
      <Leaders
        rows={[
          [
            "Reject above",
            `${formatPct(current.maxOverpayPctHundredths)} and ${formatUsd(current.maxOverpayAbsCents as Policy["maxOverpayAbsCents"])}`,
          ],
          ["Hold orders above", formatUsd(current.orderCapCents as Policy["orderCapCents"])],
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
      {props.note === null ? null : (
        <p className="slip-note slip-pen" role="status">
          {props.note}
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
          <KillSwitch pendingHolds={summary.pendingHolds} onRevoked={setRevoked} />
        </>
      ) : null}
      {summary.status === "REVOKED" ? (
        <>
          <hr className="slip-rule" />
          {revoked === null ? null : <RevokeSummary result={revoked} />}
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
