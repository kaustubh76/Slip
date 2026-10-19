import { NextResponse } from "next/server";
import { publicUrl } from "../../../../server/public-url";
import { deps } from "../../../../server/runtime";

/** Where PayPal sends the owner if they change their mind. Nothing was saved, so nothing to undo. */
export async function GET(): Promise<NextResponse> {
  const { config } = await deps();
  return NextResponse.redirect(publicUrl(config.publicBaseUrl, "/mandate?setup=cancelled"));
}
