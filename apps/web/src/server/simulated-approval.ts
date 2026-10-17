import "server-only";
import type { AppDeps } from "@slip/app";
import type { Policy } from "@slip/domain";
import type { DemoPayPal } from "./demo/paypal";

/**
 * The page that plays PayPal's part while there are no sandbox keys: the owner approves saving a
 * (stand-in) payment method for one mandate setup. Setup references are short and sequential, so
 * the setup must belong to the owner who is signed in; anyone else's is "not found".
 */

export type SimulatedSetup =
  | { status: "pending"; mandateId: string; policy: Policy }
  | { status: "settled"; mandateId: string }
  | { status: "not-found" };

export async function findSimulatedSetup(
  deps: AppDeps,
  ownerId: string,
  reference: string,
): Promise<SimulatedSetup> {
  const mandate = await deps.store.mandates.findBySetupOrderId(reference);
  if (mandate === null || mandate.ownerId !== ownerId) {
    return { status: "not-found" };
  }
  if (mandate.status !== "PENDING") {
    return { status: "settled", mandateId: mandate.id };
  }
  return {
    status: "pending",
    mandateId: mandate.id,
    policy: await deps.store.mandates.currentPolicy(mandate.id),
  };
}

/** The owner approves at (simulated) PayPal; Slip then reads the saved method on the way back. */
export async function approveSimulatedSetup(
  deps: AppDeps,
  gateway: DemoPayPal,
  ownerId: string,
  reference: string,
): Promise<SimulatedSetup> {
  const found = await findSimulatedSetup(deps, ownerId, reference);
  if (found.status !== "pending") {
    return found;
  }
  try {
    gateway.approveSetup(reference);
  } catch {
    return { status: "not-found" };
  }
  return found;
}
