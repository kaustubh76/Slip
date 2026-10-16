import { NextResponse } from "next/server";

/** Where PayPal sends the owner if they change their mind. Nothing was saved, so nothing to undo. */
export async function GET(request: Request): Promise<NextResponse> {
  return NextResponse.redirect(new URL("/mandate?setup=cancelled", request.url));
}
