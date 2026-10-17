import { agentCards } from "@slip/app";
import { SlipHydrate } from "@slip/ui";
import { seedSlipQueries } from "@slip/ui/server";
import { notFound } from "next/navigation";
import { stampTokenFor } from "../../server/live";
import { requireOwner } from "../../server/owner";
import { AgentsView } from "../../views/AgentsView";

export const dynamic = "force-dynamic";

/** Each agent's report card, and the keys that let them spend. */
export default async function Agents() {
  const { ownerId, mandateId, deps } = await requireOwner();
  const token = await stampTokenFor(deps, mandateId);
  const agents = await agentCards(deps, ownerId, mandateId);
  if (agents === null) {
    notFound();
  }
  return (
    <SlipHydrate state={seedSlipQueries({ agents })}>
      <AgentsView token={token} />
    </SlipHydrate>
  );
}
