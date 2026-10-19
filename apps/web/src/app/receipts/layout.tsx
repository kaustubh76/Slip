import { agentCards, listReceipts, ownerHolds } from "@slip/app";
import { SlipHydrate } from "@slip/ui";
import { seedSlipQueries } from "@slip/ui/server";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { stampTokenFor } from "../../server/live";
import { requireOwner } from "../../server/owner";
import { ReceiptsWorkbench } from "../../views/ReceiptsWorkbench";

export const dynamic = "force-dynamic";

/**
 * The bench every receipts screen is read on: what is waiting, the roll, and a dock for the one
 * open slip. Next keeps a layout mounted while its children change, so opening a receipt leaves
 * the roll exactly where it was — scrolled, filtered and still live — and only the dock changes.
 *
 * The newest receipts are rendered on the server, so the five-second sentences are in the HTML
 * before any script runs; the browser then keeps them live.
 */
export default async function ReceiptsLayout({ children }: { children: ReactNode }) {
  const { ownerId, mandateId, deps } = await requireOwner();
  // The stamp first, then the data: a change in between is caught on the first live look.
  const token = await stampTokenFor(deps, mandateId);
  const [page, holds, agents] = await Promise.all([
    listReceipts(deps, ownerId, mandateId, {}),
    ownerHolds(deps, ownerId, mandateId),
    agentCards(deps, ownerId, mandateId),
  ]);
  if (page === null || holds === null || agents === null) {
    notFound();
  }
  const state = seedSlipQueries({ receipts: { agent: null, page }, holds, agents });
  return (
    <SlipHydrate state={state}>
      <ReceiptsWorkbench token={token} serverNow={Date.now()}>
        {children}
      </ReceiptsWorkbench>
    </SlipHydrate>
  );
}
