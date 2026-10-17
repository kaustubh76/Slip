import { agentsAnswer } from "../../../../server/owner-api";
import { ownerRoute } from "../../../../server/owner-route";

export const dynamic = "force-dynamic";

/** `GET /api/v1/agents` — `{ agents: AgentCard[] }`, each with its report card. */
export const GET = ownerRoute((owner) => agentsAnswer(owner));
