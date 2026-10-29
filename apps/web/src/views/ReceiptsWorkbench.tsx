"use client";

import type { Outcome } from "@slip/domain";
import {
  countByOutcome,
  dayStarts,
  ErrorSlip,
  filterRows,
  HoldsTray,
  LiveBadge,
  OutcomeFilter,
  Roll,
  RollSummary,
  summariseAgents,
  useAgents,
  useClock,
  useHolds,
  useReceipts,
  Workbench,
} from "@slip/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { receiptHref, rollHref } from "./links";

/**
 * The roll and whatever is open beside it. The bench lives in the route's layout, so opening a
 * receipt swaps only the dock: the roll keeps its place, its filter and its live connection, and
 * the address bar still names the receipt so it can be linked to or reloaded.
 *
 * The agent filter is held here rather than in the address, because the address belongs to the
 * open receipt now; keeping it here is also what lets it survive opening one.
 */
export function ReceiptsWorkbench(props: {
  token: string;
  serverNow: number;
  children: ReactNode;
}) {
  const [agent, setAgent] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Which receipt is docked is in the address, not in state: the dock is this layout's child.
  const openId = usePathname()?.match(/^\/receipts\/([^/]+)/)?.[1];
  const receipts = useReceipts({ agent });
  const holds = useHolds();
  const agents = useAgents();
  const now = useClock(1_000, props.serverNow);
  const olderHref =
    receipts.olderCursor === null ? undefined : rollHref({ before: receipts.olderCursor, agent });
  const rows = useMemo(() => filterRows(receipts.rows, outcome), [receipts.rows, outcome]);
  const counts = useMemo(() => countByOutcome(receipts.rows), [receipts.rows]);
  const days = useMemo(() => dayStarts(rows), [rows]);
  const totals = useMemo(() => summariseAgents(agents.data ?? []), [agents.data]);
  return (
    <Workbench
      rail={
        <>
          <HoldsTray
            entries={holds.data?.pending ?? []}
            hrefFor={receiptHref}
            now={now}
            Link={Link}
            {...(openId === undefined ? {} : { openId })}
          />
          <RollSummary totals={totals} />
          <OutcomeFilter value={outcome} counts={counts} onChange={setOutcome} />
        </>
      }
      list={
        <>
          <header className="slip-roll-head">
            <h1 className="slip-meta">Receipts</h1>
            <label className="slip-meta" htmlFor="agent-filter">
              agent
            </label>
            <select
              id="agent-filter"
              className="slip-select"
              value={agent ?? ""}
              onChange={(event) => setAgent(event.target.value || null)}
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
            <ErrorSlip
              what="the receipts"
              error={receipts.error}
              onRetry={receipts.retry}
              Link={Link}
            />
          ) : null}
          <Roll
            entries={rows}
            days={days}
            hrefFor={receiptHref}
            Link={Link}
            {...(openId === undefined ? {} : { openId })}
            newAbove={receipts.newAbove}
            onRevealNew={receipts.revealNew}
            hasOlder={receipts.hasOlder || olderHref !== undefined}
            onOlder={receipts.loadOlder}
            {...(olderHref === undefined || receipts.hasOlder ? {} : { olderHref })}
            fresh={receipts.fresh}
          />
        </>
      }
      dock={props.children}
    />
  );
}
