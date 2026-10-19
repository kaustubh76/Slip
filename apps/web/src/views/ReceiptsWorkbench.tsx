"use client";

import {
  HoldsTray,
  LiveBadge,
  Roll,
  useAgents,
  useClock,
  useHolds,
  useReceipts,
  Workbench,
} from "@slip/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { useState } from "react";
import { ErrorSlip } from "../components/Slips";
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
  const receipts = useReceipts({ agent });
  const holds = useHolds();
  const agents = useAgents();
  const now = useClock(1_000, props.serverNow);
  const olderHref =
    receipts.olderCursor === null ? undefined : rollHref({ before: receipts.olderCursor, agent });
  return (
    <Workbench
      rail={
        <HoldsTray
          entries={holds.data?.pending ?? []}
          hrefFor={receiptHref}
          now={now}
          Link={Link}
        />
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
      }
      dock={props.children}
    />
  );
}
