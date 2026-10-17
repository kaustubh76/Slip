import { policyVersions } from "@slip/app";
import { SlipHydrate } from "@slip/ui";
import { seedSlipQueries } from "@slip/ui/server";
import { notFound } from "next/navigation";
import { stampTokenFor } from "../../server/live";
import { requireOwner } from "../../server/owner";
import { LimitsView } from "../../views/LimitsView";

export const dynamic = "force-dynamic";

/** The owner's limits: the form that issues the next version, then every version so far. */
export default async function Limits() {
  const { ownerId, mandateId, deps } = await requireOwner();
  const token = await stampTokenFor(deps, mandateId);
  const policies = await policyVersions(deps, ownerId, mandateId);
  if (policies === null || policies.length === 0) {
    notFound();
  }
  return (
    <SlipHydrate state={seedSlipQueries({ policies })}>
      <LimitsView token={token} />
    </SlipHydrate>
  );
}
