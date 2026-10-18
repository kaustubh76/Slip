import { apiKeyFromHeader, hashApiKey } from "@slip/app";
import { isDemo } from "../../../../../server/demo";
import { errandsFor } from "../../../../../server/demo/errands-api";
import { answer, jsonRoute, NOT_FOUND } from "../../../../../server/json";
import { logApiError } from "../../../../../server/owner-route";
import { runtime } from "../../../../../server/runtime";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/demo/errands` — demo mode only: the errands the demo agent script can run for the
 * desk its key belongs to, with the stand-in listing for each. The key only has to be known: a
 * desk whose permission was cancelled still lists its errands, so the checkout that follows is
 * where Slip refuses, as it would for a real agent.
 */
export const GET = jsonRoute(async (request: Request) => {
  if (!isDemo()) {
    return NOT_FOUND;
  }
  const key = apiKeyFromHeader(request.headers.get("authorization"));
  const { deps, fakes } = await runtime();
  const auth = key === null ? null : await deps.store.agents.authenticate(hashApiKey(key));
  if (auth === null) {
    return answer(401, {
      status: "refused",
      reason: "UNAUTHENTICATED",
      message: "Unknown or revoked API key. Issue one on the /demo console.",
    });
  }
  return answer(200, {
    agent: auth.agent.name,
    errands: errandsFor(auth.mandate.id, fakes.offers),
  });
}, logApiError);
