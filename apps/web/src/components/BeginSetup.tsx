"use client";

import { useState } from "react";
import { beginSetup, type SetupResult } from "../app/actions/mandate";
import { answerOf } from "./answer";

/** "Sign with PayPal": Slip asks PayPal for the approval link and sends the owner there. */
export function BeginSetup({ label }: { label: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SetupResult | null>(null);
  return (
    <>
      <button
        type="button"
        className="slip-button"
        data-variant="ink"
        disabled={busy}
        aria-busy={busy}
        onClick={() => {
          setBusy(true);
          void answerOf(beginSetup()).then((answer) => {
            setResult(answer);
            if (answer.status === "started") {
              window.location.href = answer.approveUrl;
              return;
            }
            setBusy(false);
          });
        }}
      >
        {busy ? "Asking PayPal…" : label}
      </button>
      {result === null || result.status === "started" ? null : (
        <p className="slip-note slip-pen" role="status">
          {result.status === "unknown"
            ? "Slip could not tell whether PayPal started the setup. Reload the page and try again."
            : result.message}
        </p>
      )}
    </>
  );
}
