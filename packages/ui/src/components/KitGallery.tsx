"use client";

import type { Outcome } from "@slip/domain";
import { type ReactNode, useState } from "react";
import { SlipClientError, type SlipClientErrorKind } from "../data/client.js";
import { SlipProvider } from "../data/provider.js";
import { FakeSlipClient } from "../fake.js";
import { countByOutcome, summariseAgents } from "../rollView.js";
import {
  agentCards,
  heldView,
  paidView,
  receiptDetail,
  rejectedView,
  releasedView,
  rollRows,
} from "../seed/index.js";
import { CopyButton } from "./CopyButton.js";
import { Countdown } from "./Countdown.js";
import { GapScale } from "./GapScale.js";
import { HoldsTray } from "./HoldsTray.js";
import { Leaders } from "./Leaders.js";
import { LiveBadge } from "./LiveBadge.js";
import { OutcomeBar } from "./OutcomeBar.js";
import { OutcomeFilter } from "./OutcomeFilter.js";
import { ReceiptSlip } from "./ReceiptSlip.js";
import { ReportCard } from "./ReportCard.js";
import { Roll, type RollEntry } from "./Roll.js";
import { RollSummary } from "./RollSummary.js";
import { ErrorSlip, FeedingPaper } from "./Slips.js";
import { Stamp, type StampKind } from "./Stamp.js";
import { StatusLine } from "./StatusLine.js";

/**
 * Every state of every piece of the kit, on one page, over a Slip with nothing behind it.
 *
 * This is the other half of `@slip/ui/fake`. The client makes the kit *mountable* without a
 * server; this makes it *visible* — the states a reader would otherwise have to drive the whole
 * application into, side by side, where a change to a token or a rule can be seen all at once
 * rather than one screen at a time.
 *
 * It takes no colours and no stylesheet of its own: every class here is one the kit already
 * defines, because a gallery that invented its own look would be showing something the product
 * does not have.
 */

const STAMPS: StampKind[] = ["PAID", "REJECTED", "HELD", "VOID"];
const HOUR_MS = 3_600_000;
/** Every way a read can fail, in the order a reader is most likely to meet them. */
const FAILURES: SlipClientErrorKind[] = ["server", "signed-out", "not-found", "invalid"];

function Case(props: { of: string; children: ReactNode }) {
  return (
    <section className="slip-sheet" aria-label={props.of}>
      <p className="slip-meta">{props.of}</p>
      <hr className="slip-rule" />
      {props.children}
    </section>
  );
}

export function KitGallery(props: { slip?: FakeSlipClient; now?: number } = {}) {
  // Made here when a host does not pass one, because a class instance cannot cross from a server
  // component to a client one — which makes the route that mounts this a ten-line file.
  const [slip] = useState(() => props.slip ?? new FakeSlipClient());
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const rows = rollRows();
  const cards = agentCards();
  const now = props.now ?? Date.parse("2026-10-29T12:00:00.000Z");
  const entries: RollEntry[] = rows.map((row) => ({ view: row.view, agent: row.agent }));
  const hrefFor = (entry: RollEntry) => `/receipts/${entry.view.receiptId}`;
  const counts = countByOutcome(rows);
  const held = entries.filter((entry) => entry.view.outcome === "HELD");
  const detail = receiptDetail();

  return (
    <SlipProvider client={slip}>
      <h1 className="slip-meta">The kit, every state</h1>

      <Case of="FeedingPaper">
        <FeedingPaper label="Receipt" />
      </Case>

      <Case of="ErrorSlip">
        {/* The states a reader would otherwise have to break a server to see. */}
        {FAILURES.map((kind) => (
          <ErrorSlip
            key={kind}
            what="the receipts"
            error={new SlipClientError(kind, 500, "not shown to anyone")}
            onRetry={() => {}}
          />
        ))}
      </Case>

      <Case of="Stamp">
        {STAMPS.map((kind) => (
          <Stamp key={kind} kind={kind} />
        ))}
      </Case>

      <Case of="OutcomeBar">
        <OutcomeBar paid={counts.PAID} rejected={counts.REJECTED} held={counts.HELD} />
        <OutcomeBar paid={0} rejected={0} held={0} />
      </Case>

      <Case of="OutcomeFilter">
        <OutcomeFilter value={outcome} counts={counts} onChange={setOutcome} />
      </Case>

      <Case of="RollSummary">
        <RollSummary totals={summariseAgents(cards)} />
        <RollSummary totals={summariseAgents([])} />
      </Case>

      <Case of="StatusLine">
        {[rejectedView(), paidView(), heldView(), releasedView()].map((view) => (
          <StatusLine key={view.receiptId + view.outcome} state={view.state} />
        ))}
      </Case>

      <Case of="Countdown">
        <Countdown expiresAt={new Date(now + 36 * HOUR_MS).toISOString()} now={now} />
        <Countdown expiresAt={new Date(now + HOUR_MS).toISOString()} now={now} />
        <Countdown expiresAt={new Date(now - HOUR_MS).toISOString()} now={now} />
      </Case>

      <Case of="GapScale">
        {detail.view.measure === null ? (
          <p className="slip-meta">This receipt compared no prices.</p>
        ) : (
          <GapScale measure={detail.view.measure} />
        )}
      </Case>

      <Case of="Leaders">
        <Leaders
          rows={[
            ["Receipts", String(rows.length)],
            ["Agents", String(cards.length)],
          ]}
        />
      </Case>

      <Case of="CopyButton">
        <CopyButton value="slip_fake_not_a_real_key" label="Copy the key" />
      </Case>

      <Case of="LiveBadge">
        <LiveBadge />
      </Case>

      <Case of="HoldsTray">
        <HoldsTray entries={held} hrefFor={hrefFor} now={now} />
        <HoldsTray entries={[]} hrefFor={hrefFor} now={now} />
      </Case>

      <Case of="Roll">
        <Roll entries={entries} hrefFor={hrefFor} />
      </Case>

      <Case of="ReceiptSlip">
        {[rejectedView(), paidView(), heldView(), releasedView()].map((view) => (
          <ReceiptSlip key={`slip-${view.receiptId}-${view.outcome}`} view={view} />
        ))}
      </Case>

      <Case of="ReportCard">
        {cards.map((card) => (
          <ReportCard key={card.agent.id} card={card} />
        ))}
      </Case>
    </SlipProvider>
  );
}
