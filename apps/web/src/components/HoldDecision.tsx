"use client";

import { ApproveDialog, DeclineDialog } from "@slip/ui";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { approve, decline, previewHoldApproval } from "../app/actions/holds";
import type { DecisionResult, PreviewResult, Refused } from "../server/hold-results";
import { answerOf } from "./answer";

/** While an answer is unknown, the page is read again this often, for this long. */
const REREAD_EVERY_MS = 1_000;
const REREAD_FOR_MS = 30_000;

type Open = "approve" | "decline" | null;
type Status = "idle" | "busy" | "unknown";

/**
 * The owner's two decisions on one hold. Nothing is assumed about what the server will say: the
 * amount comes from a preview the server computed, the confirmation sends that amount back, and
 * what is drawn afterwards is what the server returned. A decision whose answer was lost says so
 * and re-reads the receipt; it is never reported as a failure, and never sent again on its own.
 */
export function HoldDecision({
  receiptId,
  reservedCents,
}: {
  receiptId: string;
  /** What PayPal is holding, from the receipt, so declining can name it. */
  reservedCents: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Open>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [refusal, setRefusal] = useState<Refused | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [, start] = useTransition();

  // An answer that never arrived: read the receipt again until the decision shows (the hold leaves
  // PENDING and this component with it) — never send the decision a second time.
  useEffect(() => {
    if (status !== "unknown") {
      return;
    }
    const every = setInterval(() => start(() => router.refresh()), REREAD_EVERY_MS);
    const enough = setTimeout(() => clearInterval(every), REREAD_FOR_MS);
    return () => {
      clearInterval(every);
      clearTimeout(enough);
    };
  }, [status, router]);

  const close = () => {
    setOpen(null);
    setPreview(null);
    setRefusal(null);
    setStatus("idle");
    start(() => router.refresh());
  };

  const settle = (result: DecisionResult) => {
    if (result.status === "done") {
      close();
      return;
    }
    setStatus(result.status === "unknown" ? "unknown" : "idle");
    setRefusal(result.status === "refused" ? result : null);
    if (result.status === "unknown" || result.reason === "ALREADY_DECIDED") {
      start(() => router.refresh());
    }
  };

  const openApprove = () => {
    setOpen("approve");
    setPreview(null);
    setRefusal(null);
    setStatus("idle");
    void answerOf(previewHoldApproval(receiptId)).then((result) => {
      setPreview(result.status === "preview" ? result : null);
      setRefusal(result.status === "refused" ? result : null);
      setStatus(result.status === "unknown" ? "unknown" : "idle");
    });
  };

  return (
    <div className="slip-decision">
      <p className="slip-meta">Your decision</p>
      <div className="slip-dialog-actions">
        <button type="button" className="slip-button" data-variant="ink" onClick={openApprove}>
          Approve…
        </button>
        <button
          type="button"
          className="slip-button"
          onClick={() => {
            setOpen("decline");
            setRefusal(null);
            setStatus("idle");
          }}
        >
          Decline…
        </button>
      </div>
      <p className="slip-caption">
        Approving takes the money from your PayPal and completes the purchase. Declining releases
        it; nothing is charged. No decision within 48 hours releases it on its own.
      </p>
      <ApproveDialog
        open={open === "approve"}
        preview={preview?.status === "preview" ? preview : null}
        refusal={refusal}
        status={status}
        onApprove={(amountCents) => {
          setStatus("busy");
          void answerOf(approve(receiptId, amountCents)).then(settle);
        }}
        onClose={close}
      />
      <DeclineDialog
        open={open === "decline"}
        reservedCents={reservedCents}
        status={status}
        refusal={refusal}
        onDecline={() => {
          setStatus("busy");
          void answerOf(decline(receiptId)).then(settle);
        }}
        onClose={close}
      />
    </div>
  );
}
