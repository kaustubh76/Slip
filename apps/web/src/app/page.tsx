import { redirect } from "next/navigation";
import { currentOwner } from "../server/owner";

export const dynamic = "force-dynamic";

/** Straight to the roll when signed in; otherwise to the door. */
export default async function Home() {
  redirect((await currentOwner()) === null ? "/sign-in" : "/receipts");
}
