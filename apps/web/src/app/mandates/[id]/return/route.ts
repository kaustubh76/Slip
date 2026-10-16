import { completeMandateSetup } from "@slip/app";
import { NextResponse } from "next/server";
import { currentOwner, startSession } from "../../../../server/owner";

/**
 * Where PayPal sends the owner after they approve saving their payment method (the address
 * `startMandate` hands PayPal). Slip asks PayPal for the method, which is what activates the
 * mandate; the request id for that call is derived from the mandate, so this and the resolver's
 * poll are one request however often the owner reloads.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const owner = await currentOwner();
  const { id } = await params;
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url));
  if (owner === null) {
    return to("/sign-in");
  }
  const result = await completeMandateSetup(owner.deps, owner.ownerId, id);
  if (result.status === "refused") {
    return to(`/mandate?setup=${result.reason.toLowerCase()}`);
  }
  if (result.status === "active") {
    await startSession(owner.ownerId, id);
    return to("/mandate?setup=active");
  }
  return to(`/mandate?setup=${result.status}`);
}
