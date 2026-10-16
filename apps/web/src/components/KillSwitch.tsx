"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { type RevokeMandateResult, revokeTheMandate } from "../app/actions/mandate";

/**
 * The tear-off strip at the foot of the permission slip. The consequences are printed before the
 * control, the word has to be typed, and what it actually released is reported afterwards —
 * including a PayPal deletion that did not go through, which the resolver keeps retrying.
 */
export function KillSwitch({ pendingHolds }: { pendingHolds: number }) {
  const router = useRouter();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RevokeMandateResult | null>(null);

  if (result?.status === "revoked") {
    return (
      <section className="slip-tear-off" aria-label="Cancel this permission">
        <p className="slip-meta">Cancelled</p>
        <p className="slip-sentence">Slip will not pay for anything else under this permission.</p>
        <ul className="slip-prose">
          <li>Every checkout from now on is refused.</li>
          <li>
            {result.holdsDeclined === 0
              ? "There was nothing waiting to release."
              : `${result.holdsDeclined} ${result.holdsDeclined === 1 ? "hold was" : "holds were"} released; nothing was charged.`}
          </li>
          <li>
            {result.vault === "deleted"
              ? "Your saved payment method was deleted at PayPal."
              : result.vault === "nothing-to-delete"
                ? "There was no saved payment method left to delete."
                : "PayPal has not confirmed deleting the saved method yet; Slip keeps asking until it does."}
          </li>
        </ul>
        <button type="button" className="slip-button" onClick={() => router.refresh()}>
          Done
        </button>
      </section>
    );
  }

  return (
    <section className="slip-tear-off" aria-label="Cancel this permission">
      <p className="slip-meta">Cancel this permission</p>
      <p className="slip-prose">This cannot be undone. If you do it:</p>
      <ul className="slip-prose">
        <li>every checkout by every agent under this permission is refused, at once;</li>
        <li>
          {pendingHolds === 0
            ? "nothing is waiting for you, so nothing is released;"
            : `${pendingHolds} ${pendingHolds === 1 ? "purchase waiting" : "purchases waiting"} for you ${pendingHolds === 1 ? "is" : "are"} released, and nothing is charged;`}
        </li>
        <li>your saved payment method is deleted at PayPal;</li>
        <li>your receipts stay, so you can still read what happened.</li>
      </ul>
      <div className="slip-field">
        <label htmlFor="revoke-word" className="slip-field-label">
          Type REVOKE
        </label>
        <input
          id="revoke-word"
          className="slip-blank"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="slip-dialog-actions">
        <button
          type="button"
          className="slip-button"
          disabled={busy || typed.trim().toUpperCase() !== "REVOKE"}
          aria-busy={busy}
          onClick={() => {
            setBusy(true);
            void revokeTheMandate(typed).then((answer) => {
              setBusy(false);
              setResult(answer);
              router.refresh();
            });
          }}
        >
          {busy ? "Tearing the slip…" : "Tear the slip"}
        </button>
      </div>
      {result === null ? null : (
        <p className="slip-note slip-pen" role="status">
          {result.status === "unknown"
            ? "Slip could not tell whether that went through. Reload the page to see where the permission stands."
            : result.message}
        </p>
      )}
    </section>
  );
}
