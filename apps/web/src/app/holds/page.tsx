import { ownerHolds } from "@slip/app";
import { SlipHydrate } from "@slip/ui";
import { seedSlipQueries } from "@slip/ui/server";
import { notFound } from "next/navigation";
import { stampTokenFor } from "../../server/live";
import { requireOwner } from "../../server/owner";
import { HoldsView } from "../../views/HoldsView";

export const dynamic = "force-dynamic";

/** The in-tray: every purchase waiting for the owner, soonest to expire first. */
export default async function Holds() {
  const { ownerId, mandateId, deps } = await requireOwner();
  const token = await stampTokenFor(deps, mandateId);
  const holds = await ownerHolds(deps, ownerId, mandateId);
  if (holds === null) {
    notFound();
  }
  return (
    <SlipHydrate state={seedSlipQueries({ holds })}>
      <HoldsView token={token} />
    </SlipHydrate>
  );
}
