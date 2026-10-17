import { runCheckout } from "@slip/app";
import { bearerKey, checkoutResponse } from "../../../../../server/agent-api";
import { answer, jsonRoute } from "../../../../../server/json";
import { logApiError } from "../../../../../server/owner-route";
import { deps } from "../../../../../server/runtime";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/agent/checkout` — the one call an agent makes: "I want to pay for this offer."
 * Slip checks it and answers paid, rejected or held. The key identifies the agent, so the body
 * carries no agent id, and any price it sends is ignored: Slip prices from its own snapshot.
 *
 * This is the same use case the MCP server will wrap, so an agent that works here works there.
 */
export const POST = jsonRoute(async (request: Request) => {
  const key = bearerKey(request.headers.get("authorization"));
  if (key === null) {
    return answer(401, {
      status: "refused",
      reason: "UNAUTHENTICATED",
      message: "Send your Slip key as `Authorization: Bearer slip_live_…`.",
    });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return answer(400, {
      status: "refused",
      reason: "INVALID_REQUEST",
      message: "The body must be JSON.",
    });
  }
  const result = checkoutResponse(await runCheckout(await deps(), key, body));
  return answer(result.status, result.body);
}, logApiError);
