import "server-only";
import { type JsonAnswer, jsonRoute, UNAUTHENTICATED } from "./json";
import { currentOwner, type OwnerContext } from "./owner";
import { deps } from "./runtime";

/** Reports an endpoint's failure through the application's logger, or stderr if even that fails. */
export function logApiError(error: unknown): void {
  deps()
    .then((d) => d.log.error("web.api_failed", { error: String(error) }))
    .catch(() => console.error("web.api_failed", String(error)));
}

/** A JSON endpoint for the signed-in owner: 401 without a session, a logged 500 on a throw. */
export function ownerRoute<C>(
  handler: (owner: OwnerContext, request: Request, context: C) => Promise<JsonAnswer>,
): (request: Request, context: C) => Promise<Response> {
  return jsonRoute(async (request: Request, context: C) => {
    const owner = await currentOwner();
    return owner === null ? UNAUTHENTICATED : handler(owner, request, context);
  }, logApiError);
}
