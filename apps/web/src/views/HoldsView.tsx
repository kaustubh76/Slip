"use client";

import { Countdown, LiveBadge, ReceiptSlip, Roll, useClock, useHolds } from "@slip/ui";
import Link from "next/link";
import { useCallback, useState } from "react";
import { HoldDecision } from "../components/HoldDecision";
import { ErrorSlip } from "../components/Slips";
import { receiptHref } from "./links";

/**
 * The in-tray, live: every purchase waiting for the owner, soonest to expire first, then the ones
 * decided most recently. A hold whose dialog is open stays on screen even if it is decided
 * elsewhere meanwhile, so the dialog can say so instead of disappearing.
 */
export function HoldsView(props: { token: string; serverNow: number }) {
  const holds = useHolds();
  const now = useClock(1_000, props.serverNow);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const watch = useCallback(
    (id: string) => (isOpen: boolean) =>
      setOpen((now) => {
        if (now.has(id) === isOpen) {
          return now;
        }
        const next = new Set(now);
        if (isOpen) {
          next.add(id);
        } else {
          next.delete(id);
        }
        return next;
      }),
    [],
  );
  const pending = holds.data?.pending ?? [];
  const decided = holds.data?.decided ?? [];
  const waitingIds = new Set(pending.map((r) => r.view.receiptId));
  const kept = decided.filter(
    (r) => open.has(r.view.receiptId) && !waitingIds.has(r.view.receiptId),
  );
  const shown = [...pending, ...kept];
  const past = decided.filter((r) => !open.has(r.view.receiptId));
  return (
    <>
      <header className="slip-roll-head">
        <h1 className="slip-meta">In tray</h1>
        <LiveBadge initialToken={props.token} />
      </header>
      {holds.isError ? <ErrorSlip what="the in-tray" error={holds.error} /> : null}
      {shown.length === 0 ? (
        <article className="slip-sheet" data-perforated="">
          <p className="slip-sentence">
            Nothing in the tray. Held purchases appear here with 48 hours to decide.
          </p>
          <p>
            <Link href="/receipts" className="slip-link">
              Back to the roll →
            </Link>
          </p>
        </article>
      ) : (
        <div className="slip-cards">
          {shown.map(({ view, agent }) => (
            <ReceiptSlip key={view.receiptId} view={view} agentName={agent.name}>
              {view.hold === null || view.hold.status !== "PENDING" ? null : (
                <Countdown expiresAt={view.hold.expiresAt} now={now} />
              )}
              <HoldDecision view={view} onOpenChange={watch(view.receiptId)} />
            </ReceiptSlip>
          ))}
        </div>
      )}
      {past.length === 0 ? null : (
        <section aria-labelledby="decided-title">
          <h2 id="decided-title" className="slip-meta">
            Decided
          </h2>
          <Roll entries={past} hrefFor={receiptHref} Link={Link} />
        </section>
      )}
    </>
  );
}
