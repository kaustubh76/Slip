import { receiptsAnswer } from "../../../../server/owner-api";
import { ownerRoute } from "../../../../server/owner-route";

export const dynamic = "force-dynamic";

/** `GET /api/v1/receipts?before=&agent=&limit=` — the roll, newest first (`ReceiptPageSchema`). */
export const GET = ownerRoute((owner, request) =>
  receiptsAnswer(owner, new URL(request.url).searchParams),
);
