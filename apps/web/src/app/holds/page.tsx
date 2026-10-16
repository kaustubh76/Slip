import { pendingHolds } from "@slip/app";
import { ReceiptSlip } from "@slip/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HoldDecision } from "../../components/HoldDecision";
import { requireOwner } from "../../server/owner";

export const dynamic = "force-dynamic";

/** The in-tray: every purchase waiting for the owner, soonest to expire first. */
export default async function Holds() {
  const { ownerId, mandateId, deps } = await requireOwner();
  const waiting = await pendingHolds(deps, ownerId, mandateId);
  if (waiting === null) {
    notFound();
  }
  if (waiting.length === 0) {
    return (
      <article className="slip-sheet" data-perforated="">
        <p className="slip-meta">In tray</p>
        <p className="slip-sentence">
          Nothing in the tray. Held purchases appear here with 48 hours to decide.
        </p>
        <p>
          <Link href="/receipts" className="slip-link">
            Back to the roll →
          </Link>
        </p>
      </article>
    );
  }
  return (
    <>
      {waiting.map(({ view, agent }) => (
        <ReceiptSlip key={view.receiptId} view={view} agentName={agent.name}>
          <HoldDecision receiptId={view.receiptId} reservedCents={view.reservedCents} />
        </ReceiptSlip>
      ))}
    </>
  );
}
