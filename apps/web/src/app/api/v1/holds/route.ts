import { holdsAnswer } from "../../../../server/owner-api";
import { ownerRoute } from "../../../../server/owner-route";

export const dynamic = "force-dynamic";

/** `GET /api/v1/holds` — waiting holds and the most recently decided (`HoldsSchema`). */
export const GET = ownerRoute((owner) => holdsAnswer(owner));
