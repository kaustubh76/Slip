import { receiptDetail } from "@slip/app";
import { SlipHydrate } from "@slip/ui";
import { seedSlipQueries } from "@slip/ui/server";
import { notFound } from "next/navigation";
import { stampTokenFor } from "../../../server/live";
import { requireOwner } from "../../../server/owner";
import { ReceiptView } from "../../../views/ReceiptView";

export const dynamic = "force-dynamic";

/** One receipt in full: the five-second part, then everything behind it. */
export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { ownerId, mandateId, deps } = await requireOwner();
  const { id } = await params;
  const token = await stampTokenFor(deps, mandateId);
  const detail = await receiptDetail(deps, ownerId, id);
  if (detail === null) {
    notFound();
  }
  return (
    <SlipHydrate state={seedSlipQueries({ receipt: detail })}>
      <ReceiptView id={detail.view.receiptId} token={token} />
    </SlipHydrate>
  );
}
