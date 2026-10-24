import "server-only";
import { originHosts } from "@slip/mcp";
import { FOREIGN_ORIGIN, type JsonAnswer, jsonRoute, UNAUTHENTICATED } from "./json";
import { judgeOrigin } from "./origin";
import { currentOwner, type OwnerContext } from "./owner";
import { deps } from "./runtime";

/** Reports an endpoint's failure through the application's logger, or stderr if even that fails. */
export function logApiError(error: unknown): void {
  deps()
    .then((d) => d.log.error("web.api_failed", { error: String(error) }))
    .catch(() => console.error("web.api_failed", String(error)));
}

/**
 * A JSON endpoint for the signed-in owner: 401 without a session, a logged 500 on a throw, and —
 * for anything that is not a GET — a 403 when the request says it came from another site (D83).
 *
 * The provenance check lives here rather than in the routes that need it, so that an owner write
 * added later is covered by having been written at all. The reads are left alone: they change
 * nothing, and a cross-site page cannot read their answer anyway.
 */
export function ownerRoute<C>(
  handler: (owner: OwnerContext, request: Request, context: C) => Promise<JsonAnswer>,
): (request: Request, context: C) => Promise<Response> {
  return jsonRoute(async (request: Request, context: C) => {
    const owner = await currentOwner();
    if (owner === null) {
      return UNAUTHENTICATED;
    }
    if (request.method !== "GET" && !sameSite(request, owner)) {
      return FOREIGN_ORIGIN;
    }
    return handler(owner, request, context);
  }, logApiError);
}

/** Judged against Slip's own address, never the request's: behind a proxy they are not the same. */
function sameSite(request: Request, owner: OwnerContext): boolean {
  return (
    judgeOrigin({
      origin: request.headers.get("origin"),
      allowed: originHosts(owner.deps.config.publicBaseUrl),
    }) === "ok"
  );
}
