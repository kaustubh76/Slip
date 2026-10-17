"use client";

import { HoldsTray, LiveBadge, Roll, useAgents, useClock, useHolds, useReceipts } from "@slip/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ErrorSlip } from "../components/Slips";
import { receiptHref, rollHref } from "./links";

/**
 * The roll, live: what is waiting for the owner, then every receipt newest first. A receipt the
 * agent just tried prints at the top while the owner is there; further down the page it waits
 * behind the "new receipts" pill.
 */
export function ReceiptsView(props: { agent: string | null; token: string; serverNow: number }) {
  const router = useRouter();
  const receipts = useReceipts({ agent: props.agent });
  const holds = useHolds();
  const agents = useAgents();
  const now = useClock(1_000, props.serverNow);
  const olderHref =
    receipts.olderCursor === null
      ? undefined
      : rollHref({ before: receipts.olderCursor, agent: props.agent });
  return (
    <>
      <HoldsTray entries={holds.data?.pending ?? []} hrefFor={receiptHref} now={now} Link={Link} />
      <header className="slip-roll-head">
        <h1 className="slip-meta">Receipts</h1>
        <label className="slip-meta" htmlFor="agent-filter">
          agent
        </label>
        <select
          id="agent-filter"
          className="slip-select"
          value={props.agent ?? ""}
          onChange={(event) => router.push(rollHref({ agent: event.target.value || null }))}
        >
          <option value="">all</option>
          {(agents.data ?? []).map((card) => (
            <option key={card.agent.id} value={card.agent.id}>
              {card.agent.name}
            </option>
          ))}
        </select>
        <LiveBadge initialToken={props.token} />
      </header>
      {receipts.status === "error" ? (
        <ErrorSlip what="the receipts" error={receipts.error} />
      ) : null}
      <Roll
        entries={receipts.rows}
        hrefFor={receiptHref}
        Link={Link}
        newAbove={receipts.newAbove}
        onRevealNew={receipts.revealNew}
        hasOlder={receipts.hasOlder || olderHref !== undefined}
        onOlder={receipts.loadOlder}
        {...(olderHref === undefined || receipts.hasOlder ? {} : { olderHref })}
        fresh={receipts.fresh}
      />
    </>
  );
}
