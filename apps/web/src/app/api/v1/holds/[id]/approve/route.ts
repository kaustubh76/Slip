import { approveAnswer } from "../../../../../../server/hold-api";
import { ownerRoute } from "../../../../../../server/owner-route";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/holds/:id/approve` — the owner lets a held purchase through, over REST rather than
 * from the browser's own form. Body: `{ expectedAmountCents }`, which `/preview` supplies.
 */
export const POST = ownerRoute<{ params: Promise<{ id: string }> }>(
  async (owner, request, context) =>
    approveAnswer(owner, (await context.params).id, await request.json().catch(() => null)),
);
