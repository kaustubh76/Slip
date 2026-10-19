"use client";

import { LiveBadge, ReportCard, useAgents } from "@slip/ui";
import { IssueAgentKey, RevokeAgentKey } from "../components/AgentKeys";
import { ErrorSlip } from "../components/Slips";

/** Each agent's report card, live, and the keys that let them spend. */
export function AgentsView(props: { token: string }) {
  const agents = useAgents();
  return (
    <>
      <header className="slip-roll-head">
        <h1 className="slip-meta">Agents</h1>
        <LiveBadge initialToken={props.token} />
      </header>
      {agents.isError ? <ErrorSlip what="your agents" error={agents.error} /> : null}
      <div className="slip-cards">
        {(agents.data ?? []).map((card) => (
          <div key={card.agent.id} className="slip-stack">
            <ReportCard card={card} />
            {card.agent.revokedAt === null ? (
              <div className="slip-dialog-actions">
                <RevokeAgentKey agentId={card.agent.id} name={card.agent.name} />
              </div>
            ) : (
              <p className="slip-caption">
                This key was revoked. The agent's receipts stay; it can no longer spend.
              </p>
            )}
          </div>
        ))}
      </div>
      <article className="slip-sheet" data-perforated="">
        <p className="slip-meta">New agent</p>
        <p className="slip-prose">
          An agent spends under this mandate, within your limits, using a key of its own.
        </p>
        <IssueAgentKey />
      </article>
    </>
  );
}
