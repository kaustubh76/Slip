"use client";

import { LiveBadge, ReceiptSlip, useReceipt } from "@slip/ui";
import Link from "next/link";
import { BehindTheReceipt } from "../components/BehindTheReceipt";
import { HoldDecision } from "../components/HoldDecision";
import { ErrorSlip, FeedingPaper } from "../components/Slips";

/** One receipt in full, live: the five-second part, the decision if it waits, everything behind. */
export function ReceiptView(props: { id: string; token: string }) {
  const receipt = useReceipt(props.id);
  const detail = receipt.data;
  return (
    <>
      <header className="slip-roll-head">
        <Link href="/receipts" className="slip-link">
          ← Back to the roll
        </Link>
        <LiveBadge initialToken={props.token} />
      </header>
      {detail === undefined ? (
        receipt.isError ? (
          <ErrorSlip
            what="this receipt"
            error={receipt.error}
            onRetry={() => void receipt.refetch()}
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
