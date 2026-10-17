import { answer } from "../../../../server/json";
import { stampTokenFor } from "../../../../server/live";
import { ownerRoute } from "../../../../server/owner-route";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/stamp` — how much has happened under this owner's mandate, as one short token.
 * The owner's pages poll it and re-read what changed. It is never cached by the browser, and it
 * says nothing about what changed beyond which counters moved.
 */
export const GET = ownerRoute(async (owner) =>
  answer(200, { token: await stampTokenFor(owner.deps, owner.mandateId) }),
);
