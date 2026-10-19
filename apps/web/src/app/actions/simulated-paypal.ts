"use server";

import { completeMandateSetup } from "@slip/app";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isDemo } from "../../server/demo";
import { requireOwner, startSession } from "../../server/owner";
import { runtime, SERVICES } from "../../server/runtime";
import { approveSimulatedSetup, findSimulatedSetup } from "../../server/simulated-approval";

const ReferenceSchema = z.string().trim().min(1).max(100);

function referenceOf(form: FormData): string | null {
  const parsed = ReferenceSchema.safeParse(form.get("reference"));
  return parsed.success ? parsed.data : null;
}

/** "Approve" on the simulated PayPal page; then back to Slip, which reads the saved method. */
export async function approveOnSimulatedPayPal(form: FormData): Promise<void> {
  const reference = referenceOf(form);
  if (SERVICES.payment !== "simulated" || reference === null) {
    redirect("/mandate?setup=not_found");
  }
  const { ownerId } = await requireOwner();
  const { deps, standIns } = await runtime();
  if (standIns.gateway === null) {
    redirect("/mandate?setup=not_found");
  }
  const result = await approveSimulatedSetup(
    deps,
    { gateway: standIns.gateway, stock: isDemo() ? standIns.offers : null },
    ownerId,
    reference,
  );
  if (result.status === "not-found") {
    redirect("/mandate?setup=not_found");
  }
  // Finish the setup here rather than bouncing through `/mandates/<id>/return`. That route exists
  // for PayPal's own redirect, which is a top-level browser GET; a server action redirecting into
  // it makes the client router navigate to a route handler, which answers with a 307 and no RSC
  // payload — and the owner sees Slip's error page instead of their permission.
  const completed = await completeMandateSetup(deps, ownerId, result.mandateId);
  if (completed.status === "active") {
    await startSession(ownerId, result.mandateId);
  }
  redirect(
    `/mandate?setup=${completed.status === "refused" ? completed.reason.toLowerCase() : completed.status}`,
  );
}

/** "Cancel" on the simulated PayPal page: back to Slip with nothing saved. */
export async function cancelOnSimulatedPayPal(form: FormData): Promise<void> {
  const reference = referenceOf(form);
  if (SERVICES.payment !== "simulated" || reference === null) {
    redirect("/mandate?setup=not_found");
  }
  const { ownerId } = await requireOwner();
  const { deps } = await runtime();
  const found = await findSimulatedSetup(deps, ownerId, reference);
  redirect(
    found.status === "not-found"
      ? "/mandate?setup=not_found"
      : `/mandates/${found.mandateId}/cancel`,
  );
}
