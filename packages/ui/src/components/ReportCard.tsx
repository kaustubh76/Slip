import { type AgentReport, type Cents, formatUsd } from "@slip/domain";
import { percentFromHundredths } from "@slip/receipt";
import { Leaders } from "./Leaders.js";
import { Stamp } from "./Stamp.js";
import { printedAt } from "./text.js";

/** An agent and its report card, as the server sends them. */
export interface ReportCardData {
  agent: {
    id: string;
    name: string;
    apiKeyPrefix: string;
    createdAt: string;
    revokedAt: string | null;
  };
  report: { report: AgentReport; lines: string[] };
}

const pct = (hundredths: number | null) =>
  hundredths === null ? "—" : `${percentFromHundredths(hundredths)}`;

/** Each agent's report card: what it tried, what Slip decided, how far from the cheapest. */
export function ReportCard({ card }: { card: ReportCardData }) {
  const r = card.report.report;
  const headingId = `report-${card.agent.id}`;
  return (
    <article className="slip-sheet" aria-labelledby={headingId}>
      <header className="slip-receipt-head">
        <h2 id={headingId} className="slip-meta">
          Report card · {card.agent.name}
        </h2>
        {card.agent.revokedAt === null ? null : <Stamp kind="VOID" label="REVOKED" />}
        <p className="slip-meta">key {card.agent.apiKeyPrefix}…</p>
        <p className="slip-meta">since {printedAt(card.agent.createdAt)}</p>
      </header>
      <hr className="slip-rule" />
      {card.report.lines.map((line) => (
        <p key={line} className="slip-prose">
          {line}
        </p>
      ))}
      <Leaders
        rows={[
          ["Attempted", r.attempted],
          ["Paid", r.paid],
          ["Rejected", r.rejected],
          ["Held for you", r.held],
          ["Payments completed", r.captured],
          ["Not the cheapest", r.notCheapest],
          ["Typical gap", pct(r.medianGapPctHundredths)],
          [
            "Widest gap",
            r.worstGapPctHundredths === null || r.worstGapAbsCents === null
              ? "—"
              : `${pct(r.worstGapPctHundredths)} · ${formatUsd(r.worstGapAbsCents as Cents)}`,
          ],
          ["Steered listings", r.steered],
          ["Commission conflicts", r.conflicts],
        ]}
      />
      <p className="slip-caption">
        Owner-approved follow-ups are not counted as the agent's choices.
      </p>
    </article>
  );
}
