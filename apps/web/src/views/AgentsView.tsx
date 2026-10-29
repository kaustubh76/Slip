"use client";

import { ErrorSlip, LiveBadge, ReportCard, useAgents } from "@slip/ui";
import Link from "next/link";
import { IssueAgentKey, RevokeAgentKey } from "../components/AgentKeys";
import { ConnectAgent } from "../components/ConnectAgent";

/** Each agent's report card, live, and the keys that let them spend. */
export function AgentsView(props: { token: string; base: string }) {
  const agents = useAgents();
  return (
    <>
      <header className="slip-roll-head">
        <h1 className="slip-meta">Agents</h1>
        <LiveBadge initialToken={props.token} />
      </header>
      {agents.isError ? (
        <ErrorSlip
          what="your agents"
          error={agents.error}
          onRetry={() => void agents.refetch()}
          Link={Link}
        />
      ) : null}
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
        {/* The next card in the same grid, so one agent does not leave a column standing empty. */}
        <article className="slip-sheet" data-perforated="">
          <p className="slip-meta">New agent</p>
          <p className="slip-prose">
            An agent spends under this mandate, within your limits, using a key of its own.
          </p>
          <IssueAgentKey base={props.base} />
        </article>
        {/* Where to point it, for an owner whose key was issued on some earlier day. */}
        <article className="slip-sheet" data-perforated="">
          <p className="slip-meta">Connect an agent</p>
          <p className="slip-prose">
            Any MCP client can reach this Slip, with an agent's key as its bearer token. The agent
            searches, chooses, and pays through Slip — which checks each purchase first.
          </p>
          <ConnectAgent base={props.base} />
        </article>
      </div>
    </>
  );
}
