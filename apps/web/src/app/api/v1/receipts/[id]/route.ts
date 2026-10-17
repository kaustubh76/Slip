import { receiptAnswer } from "../../../../../server/owner-api";
import { ownerRoute } from "../../../../../server/owner-route";

export const dynamic = "force-dynamic";

/** `GET /api/v1/receipts/:id` — one receipt with everything behind it (`ReceiptDetailSchema`). */
export const GET = ownerRoute<{ params: Promise<{ id: string }> }>(
  async (owner, _request, context) => receiptAnswer(owner, (await context.params).id),
);
