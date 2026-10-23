import { previewAnswer } from "../../../../../../server/hold-api";
import { ownerRoute } from "../../../../../../server/owner-route";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/holds/:id/preview` — what approving would charge, and which way it would be paid.
 * A POST rather than a GET because a hold with nothing reserved asks Channel3 for today's prices,
 * so it is a thing the owner triggers and not something a page may do on its own.
 */
export const POST = ownerRoute<{ params: Promise<{ id: string }> }>(
  async (owner, _request, context) => previewAnswer(owner, (await context.params).id),
);
