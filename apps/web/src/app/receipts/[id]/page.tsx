import { receiptDetail } from "@slip/app";
import { SlipHydrate } from "@slip/ui";
import { seedSlipQueries } from "@slip/ui/server";
import { notFound } from "next/navigation";
import { requireOwner } from "../../../server/owner";
import { ReceiptView } from "../../../views/ReceiptView";

export const dynamic = "force-dynamic";

/** One receipt in full: the five-second part, then everything behind it. */
export default async function Receipt({ params }: { params: Promise<{ id: string }> }) {
  const { ownerId, deps } = await requireOwner();
  const { id } = await params;
  const detail = await receiptDetail(deps, ownerId, id);
  if (detail === null) {
    notFound();
  }
  return (
    <SlipHydrate state={seedSlipQueries({ receipt: detail })}>
      <ReceiptView id={detail.view.receiptId} />
    </SlipHydrate>
  );
}
