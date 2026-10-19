import { mandateSummary, policyVersions } from "@slip/app";
import { SlipHydrate } from "@slip/ui";
import { seedSlipQueries } from "@slip/ui/server";
import { notFound } from "next/navigation";
import { stampTokenFor } from "../../server/live";
import { requireOwner } from "../../server/owner";
import { MandateView } from "../../views/MandateView";

export const dynamic = "force-dynamic";

const SETUP_NOTES: Record<string, string> = {
  active: "PayPal has saved your payment method. Slip can now pay within your limits.",
  pending:
    "PayPal has your approval but has not issued the payment method yet. Slip keeps asking; this page will say so once it has.",
  "not-approved": "PayPal has not recorded an approval for this setup. You can send it again.",
  cancelled: "Nothing was saved at PayPal, so there is nothing to undo.",
  setup_failed: "PayPal could not confirm the saved payment method. You can try again.",
  revoked: "This permission was cancelled. Start a new one.",
  not_found: "That setup does not belong to this account.",
};

/**
 * The permission slip: what the owner allowed, which limits are in force, and — on a stub beside
 * it — the one control that stops everything.
 */
export default async function Mandate({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}) {
  const { ownerId, mandateId, deps } = await requireOwner();
  const token = await stampTokenFor(deps, mandateId);
  const [mandate, policies, { setup }] = await Promise.all([
    mandateSummary(deps, ownerId, mandateId),
    policyVersions(deps, ownerId, mandateId),
    searchParams,
  ]);
  if (mandate === null || policies === null || policies.length === 0) {
    notFound();
  }
  const note = setup === undefined ? null : (SETUP_NOTES[setup] ?? null);
  return (
    <SlipHydrate state={seedSlipQueries({ mandate, policies })}>
      <MandateView token={token} note={note} />
    </SlipHydrate>
  );
}
