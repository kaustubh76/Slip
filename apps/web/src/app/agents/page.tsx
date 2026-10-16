import { agentCards } from "@slip/app";
import { ReportCard } from "@slip/ui";
import { notFound } from "next/navigation";
import { IssueAgentKey, RevokeAgentKey } from "../../components/AgentKeys";
import { requireOwner } from "../../server/owner";

export const dynamic = "force-dynamic";

/** Each agent's report card, and the keys that let them spend. */
export default async function Agents() {
  const { ownerId, mandateId, deps } = await requireOwner();
  const cards = await agentCards(deps, ownerId, mandateId);
  if (cards === null) {
    notFound();
  }
  return (
    <>
      {cards.map((card) => (
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
