"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isDemo } from "../../server/demo";
import { addressOf } from "../../server/demo/desks";
import { seedDemoOwner } from "../../server/demo/seed";
import { endSession, startSession } from "../../server/owner";
import { runtime } from "../../server/runtime";

/**
 * Signs in to the demo: a fresh owner, mandate and agent each time, so no visitor can revoke
 * another's mandate or read their receipts. There is no password because there is nothing to
 * protect — every demo owner is created on the spot and holds nothing but stand-in PayPal money.
 * Desks are never freed, so their number is capped per process and per visitor.
 */
export async function signInToDemo(): Promise<void> {
  if (!isDemo()) {
    throw new Error("demo sign-in is only available when SLIP_DEMO=1");
  }
  const { deps, fakes, demo } = await runtime();
  const admitted = demo.limiter.admit(addressOf(await headers()), deps.clock.now().getTime());
  if (admitted !== "ok") {
    redirect(`/sign-in?refused=${admitted}`);
  }
  const owner = await seedDemoOwner(deps, fakes);
  demo.desks.set(owner.mandateId, { agentId: owner.agentId, apiKey: owner.apiKey });
  await startSession(owner.ownerId, owner.mandateId);
  redirect("/receipts");
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/sign-in");
}
