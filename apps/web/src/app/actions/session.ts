"use server";

import { redirect } from "next/navigation";
import { isDemo } from "../../server/demo";
import { seedDemoOwner } from "../../server/demo-seed";
import { endSession, startSession } from "../../server/owner";
import { runtime } from "../../server/runtime";

/**
 * Signs in to the demo: a fresh owner, mandate and agent each time, so no visitor can revoke
 * another's mandate or read their receipts. There is no password because there is nothing to
 * protect — every demo owner is created on the spot and holds nothing but fake PayPal money.
 */
export async function signInToDemo(): Promise<void> {
  if (!isDemo()) {
    throw new Error("demo sign-in is only available when SLIP_DEMO=1");
  }
  const { deps, fakes } = await runtime();
  const owner = await seedDemoOwner(deps, fakes);
  await startSession(owner.ownerId, owner.mandateId);
  redirect("/receipts");
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/sign-in");
}
