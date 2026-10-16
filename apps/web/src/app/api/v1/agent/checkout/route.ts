import { runCheckout } from "@slip/app";
import { NextResponse } from "next/server";
import { bearerKey, checkoutResponse } from "../../../../../server/agent-api";
import { deps } from "../../../../../server/runtime";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/agent/checkout` — the one call an agent makes: "I want to pay for this offer."
 * Slip checks it and answers paid, rejected or held. The key identifies the agent, so the body
 * carries no agent id, and any price it sends is ignored: Slip prices from its own snapshot.
 *
 * This is the same use case the MCP server will wrap, so an agent that works here works there.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const key = bearerKey(request.headers.get("authorization"));
  if (key === null) {
    return NextResponse.json(
      {
        status: "refused",
        reason: "UNAUTHENTICATED",
        message: "Send your Slip key as `Authorization: Bearer slip_live_…`.",
      },
      { status: 401 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "refused", reason: "INVALID_REQUEST", message: "The body must be JSON." },
      { status: 400 },
    );
  }
  const application = await deps();
  const answer = checkoutResponse(await runCheckout(application, key, body));
  return NextResponse.json(answer.body, { status: answer.status });
}
