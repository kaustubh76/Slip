"use client";

import { ErrorSlip, FeedingPaper, ReceiptSlip, useReceipt } from "@slip/ui";
import Link from "next/link";
import { BehindTheReceipt } from "../components/BehindTheReceipt";
import { HoldDecision } from "../components/HoldDecision";

/**
 * One receipt in full, live: the five-second part, the decision if it waits, everything behind.
 * It sits in the roll's dock, which carries the live badge for both, so the only chrome here is a
 * way back — and that only matters where the screen was too narrow to show the roll beside it.
 */
export function ReceiptView(props: { id: string }) {
  const receipt = useReceipt(props.id);
  const detail = receipt.data;
  return (
    <>
      <header className="slip-roll-head slip-dock-back">
        <Link href="/receipts" className="slip-link">
          ← Back to the roll
        </Link>
      </header>
      {detail === undefined ? (
        receipt.isError ? (
          <ErrorSlip
            what="this receipt"
            error={receipt.error}
            onRetry={() => void receipt.refetch()}
            Link={Link}
          />
        ) : (
          <FeedingPaper label="Receipt" />
        )
      ) : (
        <ReceiptSlip
          view={detail.view}
          agentName={detail.agent.name}
          announce
          behind={<BehindTheReceipt detail={detail} />}
        >
          <HoldDecision view={detail.view} />
        </ReceiptSlip>
      )}
    </>
  );
}
