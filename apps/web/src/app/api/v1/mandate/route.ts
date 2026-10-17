import { mandateAnswer } from "../../../../server/owner-api";
import { ownerRoute } from "../../../../server/owner-route";

export const dynamic = "force-dynamic";

/** `GET /api/v1/mandate` — the permission slip at a glance (`MandateSummarySchema`). */
export const GET = ownerRoute((owner) => mandateAnswer(owner));
