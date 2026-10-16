import { receiptDetail } from "@slip/app";
import { ReceiptSlip } from "@slip/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BehindTheReceipt } from "../../../components/BehindTheReceipt";
import { HoldDecision } from "../../../components/HoldDecision";
import { requireOwner } from "../../../server/owner";

export const dynamic = "force-dynamic";

/** One receipt in full: the five-second part, then everything behind it. */
export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { ownerId, deps } = await requireOwner();
  const { id } = await params;
  const detail = await receiptDetail(deps, ownerId, id);
  if (detail === null) {
    notFound();
  }
  return (
    <>
      <p>
        <Link href="/receipts" className="slip-link">
          ← Back to the roll
        </Link>
      </p>
      <ReceiptSlip
        view={detail.view}
        agentName={detail.agent.name}
        behind={<BehindTheReceipt detail={detail} />}
      >
        {detail.view.hold?.status === "PENDING" ? (
          <HoldDecision
            receiptId={detail.view.receiptId}
            reservedCents={detail.view.reservedCents}
          />
        ) : null}
      </ReceiptSlip>
    </>
  );
}
