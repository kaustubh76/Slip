import { policiesAnswer } from "../../../../server/owner-api";
import { ownerRoute } from "../../../../server/owner-route";

export const dynamic = "force-dynamic";

/** `GET /api/v1/policies` — `{ versions: PolicyView[] }`, newest first. */
export const GET = ownerRoute((owner) => policiesAnswer(owner));
