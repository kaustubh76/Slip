/**
 * Every JSON endpoint answers the same way: a status, a body, never cached, and never a stack
 * trace. `jsonRoute` wraps a handler so a throw becomes a logged 500 with a plain message instead
 * of Next's error page — an agent or a page polling the API always gets JSON back.
 */

export interface JsonAnswer {
  status: number;
  body: unknown;
}

export const answer = (status: number, body: unknown): JsonAnswer => ({ status, body });

export const UNAUTHENTICATED: JsonAnswer = answer(401, {
  status: "refused",
  reason: "UNAUTHENTICATED",
  message: "Sign in first.",
});

export const FOREIGN_ORIGIN: JsonAnswer = answer(403, {
  status: "refused",
  reason: "FOREIGN_ORIGIN",
  message: "This request came from another site. Slip's own pages and server callers may write.",
});

export const NOT_FOUND: JsonAnswer = answer(404, {
  status: "refused",
  reason: "NOT_FOUND",
  message: "There is no such thing for this owner.",
});

export function toResponse(result: JsonAnswer): Response {
  return Response.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Runs `handler`; a throw is reported through `onError` and answered as a 500. */
export function jsonRoute<A extends unknown[]>(
  handler: (...args: A) => Promise<JsonAnswer>,
  onError: (error: unknown) => void = (error) => console.error("web.api_failed", String(error)),
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return toResponse(await handler(...args));
    } catch (error) {
      onError(error);
      return toResponse(
        answer(500, {
          status: "error",
          message: "Slip could not answer that just now. Anything already decided is kept.",
        }),
      );
    }
  };
}
