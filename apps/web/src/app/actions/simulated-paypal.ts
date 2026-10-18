"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "../../server/owner";
import { fakes, runtime, SERVICES } from "../../server/runtime";
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
  const { deps } = await runtime();
  const result = await approveSimulatedSetup(deps, await fakes(), ownerId, reference);
  redirect(
    result.status === "not-found"
      ? "/mandate?setup=not_found"
      : `/mandates/${result.mandateId}/return`,
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
