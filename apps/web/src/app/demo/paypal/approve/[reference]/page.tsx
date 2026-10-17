import { formatPct, formatUsd } from "@slip/domain";
import { Leaders } from "@slip/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "../../../../../server/owner";
import { SIMULATED_SERVICES } from "../../../../../server/runtime";
import { findSimulatedSetup } from "../../../../../server/simulated-approval";
import {
  approveOnSimulatedPayPal,
  cancelOnSimulatedPayPal,
} from "../../../../actions/simulated-paypal";

export const dynamic = "force-dynamic";

/**
 * Plays PayPal's part in signing a permission slip while no sandbox keys are configured. It says
 * so in its first line: nothing here is PayPal, and no PayPal account is involved.
 */
export default async function SimulatedApproval({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  if (!SIMULATED_SERVICES) {
    notFound();
  }
  const { ownerId, deps } = await requireOwner();
  const reference = decodeURIComponent((await params).reference);
  const setup = await findSimulatedSetup(deps, ownerId, reference);
  if (setup.status === "not-found") {
    notFound();
  }
  return (
    <article className="slip-sheet" data-perforated="">
      <p className="slip-meta">Simulated PayPal approval · sandbox keys are not configured</p>
      <h1 className="slip-title">Save a payment method for Slip?</h1>
      <p className="slip-prose">
        This page stands in for PayPal. On the real thing you would sign in to PayPal and approve
        saving your payment method for Slip, the seller in this demo. Here nothing leaves this
        server: approving saves a stand-in method that Slip can charge within your limits.
      </p>
      {setup.status === "settled" ? (
        <p className="slip-note slip-pen" role="status">
          This setup is already settled. <Link href="/mandate">Back to the permission slip</Link>.
        </p>
      ) : (
        <>
          <Leaders
            rows={[
              ["Seller", "Slip (simulated)"],
              ["Permission slip", `no. ${setup.mandateId.slice(0, 8)}`],
              [
                "Rejects above",
                `${formatPct(setup.policy.maxOverpayPctHundredths)} and ${formatUsd(setup.policy.maxOverpayAbsCents)}`,
              ],
              ["Holds orders above", formatUsd(setup.policy.orderCapCents)],
            ]}
          />
          <div className="slip-dialog-actions">
            <form action={cancelOnSimulatedPayPal}>
              <input type="hidden" name="reference" value={reference} />
              <button type="submit" className="slip-button">
                Cancel
              </button>
            </form>
            <form action={approveOnSimulatedPayPal}>
              <input type="hidden" name="reference" value={reference} />
              <button type="submit" className="slip-button" data-variant="ink">
                Approve and save
              </button>
            </form>
          </div>
        </>
      )}
    </article>
  );
}
