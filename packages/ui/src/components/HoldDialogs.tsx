"use client";

import { type Cents, formatUsd } from "@slip/domain";
import { ConfirmDialog } from "./ConfirmDialog.js";

const usd = (cents: number) => formatUsd(cents as Cents);

/** What approving would do, as the server previewed it. */
export interface ApprovalPreviewView {
  /** `capture`: take the money PayPal holds. `pay`: nothing is reserved; pay in one step. */
  kind: "capture" | "pay";
  amountCents: number;
  store: string;
}

/** A refusal from the server: nothing was written. */
export interface RefusalView {
  reason: string;
  message: string;
  /** PRICE_CHANGED: what approving would charge now. */
  amountCents?: number;
}

/**
 * Approving a hold. It names the exact amount before anything is sent, and only that amount is
 * sent back; a changed price needs a new confirmation. Money commands are never optimistic: the
 * dialog shows what the server said, and an answer that did not arrive is "Checking with
 * PayPal…", never "failed".
 */
export function ApproveDialog(props: {
  open: boolean;
  /** Null while the preview is loading. */
  preview: ApprovalPreviewView | null;
  refusal: RefusalView | null;
  status: "idle" | "busy" | "unknown";
  onApprove: (expectedAmountCents: number) => void;
  onClose: () => void;
}) {
  const { preview, refusal, status } = props;
  const changed =
    refusal?.reason === "PRICE_CHANGED" && refusal.amountCents !== undefined
      ? refusal.amountCents
      : null;
  const amount = changed ?? preview?.amountCents ?? null;
  const take = preview?.kind === "capture";
  const stuck =
    status === "unknown" ||
    preview === null ||
    (refusal !== null && changed === null && refusal.reason !== "BUSY");

  let title: string;
  if (status === "unknown") {
    title = "Checking with PayPal…";
  } else if (changed !== null && preview !== null) {
    title = `The price changed: ${usd(preview.amountCents)} → ${usd(changed)}`;
  } else if (preview === null) {
    title =
      refusal === null ? "Checking what approving would charge…" : "This hold cannot be approved";
  } else if (take) {
    title = `Take ${usd(preview.amountCents)} from your PayPal for ${preview.store}?`;
  } else {
    title = `Pay ${usd(preview.amountCents)} at ${preview.store}?`;
  }

  return (
    <ConfirmDialog
      open={props.open}
      title={title}
      confirmLabel={
        amount === null
          ? "Approve"
          : `${take ? "Approve and take" : "Approve and pay"} ${usd(amount)}`
      }
      busyLabel={amount === null ? "Approving…" : `${take ? "Taking" : "Paying"} ${usd(amount)}…`}
      busy={status === "busy"}
      confirmDisabled={stuck}
      onConfirm={() => {
        if (amount !== null) {
          props.onApprove(amount);
        }
      }}
      onClose={props.onClose}
    >
      {status === "unknown" ? (
        <p className="slip-prose">
          The answer did not arrive. Slip is checking with PayPal using the same request, so the
          money can only move once.
        </p>
      ) : changed !== null ? (
        <p className="slip-prose">Approve the new amount, or cancel. Nothing has been charged.</p>
      ) : preview === null ? null : take ? (
        <p className="slip-prose">
          Slip takes the money PayPal is holding for this purchase, once, and the purchase
          completes.
        </p>
      ) : (
        <p className="slip-prose">
          No PayPal order is behind this hold. Slip checked the price again just now; approving pays
          this amount in one step.
        </p>
      )}
      {refusal !== null && changed === null ? (
        <p className="slip-note slip-pen" role="status">
          {refusal.message}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}

/** Declining a hold: nothing is charged, and money PayPal holds is released. */
export function DeclineDialog(props: {
  open: boolean;
  /** The reserved amount, or null when nothing is reserved. */
  reservedCents: number | null;
  status: "idle" | "busy" | "unknown";
  refusal: RefusalView | null;
  onDecline: () => void;
  onClose: () => void;
}) {
  const reserved = props.reservedCents;
  return (
    <ConfirmDialog
      open={props.open}
      title={
        props.status === "unknown"
          ? "Checking with PayPal…"
          : reserved === null
            ? "Decline this purchase?"
            : `Release the ${usd(reserved)} PayPal is holding?`
      }
      confirmLabel={reserved === null ? "Decline" : "Decline and release"}
      busyLabel={reserved === null ? "Declining…" : "Releasing…"}
      busy={props.status === "busy"}
      confirmDisabled={props.status === "unknown" || props.refusal !== null}
      onConfirm={props.onDecline}
      onClose={props.onClose}
    >
      <p className="slip-prose">The agent's purchase does not go ahead. Nothing will be charged.</p>
      {props.refusal === null ? null : (
        <p className="slip-note slip-pen" role="status">
          {props.refusal.message}
        </p>
      )}
    </ConfirmDialog>
  );
}
