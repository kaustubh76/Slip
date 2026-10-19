"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isDemo } from "../../server/demo";
import { addressOf } from "../../server/demo/desks";
import { seedDemoOwner } from "../../server/demo/seed";
import { endSession, startSession } from "../../server/owner";
import { fakes, runtime, SERVICES } from "../../server/runtime";
import { startOwner } from "../../server/sign-up";

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
  const { deps, demo } = await runtime();
  const admitted = demo.limiter.admit(addressOf(await headers()), deps.clock.now().getTime());
  if (admitted !== "ok") {
    redirect(`/sign-in?refused=${admitted}`);
  }
  const owner = await seedDemoOwner(deps, await fakes());
  await startSession(owner.ownerId, owner.mandateId);
  redirect("/receipts");
}

/**
 * Starts as an owner outside the demo: Slip opens an owner and a permission, then sends the browser
 * to PayPal to approve saving a payment method. PayPal sends it back to the mandate's return route,
 * which activates the permission. Refusals come back to the sign-in page, which says why.
 */
export async function startWithPayPal(): Promise<void> {
  if (isDemo()) {
    redirect("/sign-in");
  }
  const { deps, demo } = await runtime();
  const request = await headers();
  let result: Awaited<ReturnType<typeof startOwner>>;
  try {
    result = await startOwner(deps, {
      services: SERVICES,
      host: request.get("x-forwarded-host") ?? request.get("host"),
      address: addressOf(request),
      limiter: demo.limiter,
    });
  } catch (error) {
    deps.log.error("web.start_failed", { error: String(error) });
    result = { status: "refused", reason: "PAYPAL_UNAVAILABLE" };
  }
  if (result.status === "refused") {
    redirect(`/sign-in?refused=${result.reason.toLowerCase()}`);
  }
  await startSession(result.ownerId, result.mandateId);
  redirect(result.approveUrl);
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect("/sign-in");
}
