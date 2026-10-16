import { NextResponse } from "next/server";
import { stampTokenFor } from "../../../../server/live";
import { currentOwner } from "../../../../server/owner";

export const dynamic = "force-dynamic";

/**
 * `GET /api/v1/stamp` — how much has happened under this owner's mandate, as one short token.
 * The owner's pages poll it and re-read themselves when it changes. It is never cached by the
 * browser, and it says nothing about what changed, only that something did.
 */
export async function GET(): Promise<NextResponse> {
  const owner = await currentOwner();
  if (owner === null) {
    return NextResponse.json({ error: "no session" }, { status: 401 });
  }
  return NextResponse.json(
    { token: await stampTokenFor(owner.deps, owner.mandateId) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
