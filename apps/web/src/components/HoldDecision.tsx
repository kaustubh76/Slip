"use client";

import type { ReceiptView } from "@slip/receipt";
import { ApproveDialog, DeclineDialog, type RefusalView, useHoldDecision } from "@slip/ui";
import { useEffect, useRef, useState } from "react";

type Open = "approve" | "decline" | null;

/**
 * The owner's two decisions on one hold. Nothing is assumed about what the server will say: the
 * amount comes from a preview the server computed, the confirmation sends that amount back, and
 * what is drawn afterwards is what the server returned (D48). If the hold is decided somewhere
 * else while a dialog is open — another tab, a revoke, the 48 hours running out — the dialog says
 * so instead of vanishing; `onOpenChange` lets a list keep the hold on screen meanwhile.
 */
export function HoldDecision({
  view,
  onOpenChange,
}: {
  view: ReceiptView;
  onOpenChange?: (open: boolean) => void;
}) {
  const decision = useHoldDecision(view.receiptId);
  const [open, setOpen] = useState<Open>(null);
  const pending = view.hold?.status === "PENDING";
  // Held in a ref: a parent's callback changes every render and must not re-run the effect below.
  const notify = useRef(onOpenChange);
  notify.current = onOpenChange;

  const show = (next: Open) => {
    setOpen(next);
    notify.current?.(next !== null);
  };
  const close = () => {
    decision.reset();
    show(null);
  };

  // The server said it is done: the dialog has nothing left to ask.
  useEffect(() => {
    if (decision.decided !== null) {
      setOpen(null);
      notify.current?.(false);
    }
  }, [decision.decided]);

  if (!pending && open === null) {
    return null;
  }
  const elsewhere =
    !pending &&
    decision.decided === null &&
    decision.status === "idle" &&
    decision.refusal === null;
  const refusal: RefusalView | null = elsewhere ? alreadyDecided(view) : decision.refusal;

  return (
    <div className="slip-decision">
      {pending ? (
        <>
          <p className="slip-meta">Your decision</p>
          <div className="slip-dialog-actions">
            <button
              type="button"
              className="slip-button"
              data-variant="ink"
              onClick={() => {
                show("approve");
                void decision.loadPreview();
              }}
            >
              Approve…
            </button>
            <button type="button" className="slip-button" onClick={() => show("decline")}>
              Decline…
            </button>
          </div>
          <p className="slip-caption">
            Approving takes the money from your PayPal and completes the purchase. Declining
            releases it; nothing is charged. No decision within 48 hours releases it on its own.
          </p>
        </>
      ) : null}
      <ApproveDialog
        open={open === "approve"}
        preview={decision.preview}
        refusal={refusal}
        status={decision.status}
        onApprove={(amountCents) => void decision.approve(amountCents)}
        onClose={close}
      />
      <DeclineDialog
        open={open === "decline"}
        reservedCents={view.reservedCents}
        status={decision.status}
        refusal={refusal}
        onDecline={() => void decision.decline()}
        onClose={close}
      />
    </div>
  );
}

const DECIDED_WORD = { APPROVED: "approved", DECLINED: "declined", EXPIRED: "released" } as const;

/** "Already approved by you at 14:05 UTC." */
export function alreadyDecided(view: ReceiptView): RefusalView {
  const hold = view.hold;
  const word = hold === null || hold.status === "PENDING" ? "decided" : DECIDED_WORD[hold.status];
  const who =
    hold?.status === "EXPIRED"
      ? "after 48 hours"
      : hold?.decidedBy === "system"
        ? "by Slip"
        : "by you";
  const at =
    hold?.decidedAt === null || hold === null ? "" : ` at ${hold.decidedAt.slice(11, 16)} UTC`;
  return {
    reason: "ALREADY_DECIDED",
    message: `This hold was already ${word} ${who}${at}.`,
  };
}
