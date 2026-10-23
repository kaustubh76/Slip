import { declineAnswer } from "../../../../../../server/hold-api";
import { ownerRoute } from "../../../../../../server/owner-route";

export const dynamic = "force-dynamic";

/** `POST /api/v1/holds/:id/decline` — the owner releases a held purchase. No body. */
export const POST = ownerRoute<{ params: Promise<{ id: string }> }>(
  async (owner, _request, context) => declineAnswer(owner, (await context.params).id),
);
