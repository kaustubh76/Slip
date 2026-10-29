import { KitGallery } from "@slip/ui/fake";
import { notFound } from "next/navigation";
import { isDemo } from "../../server/demo";

/**
 * `/kit` — every state of every piece of the kit, over a Slip with nothing behind it.
 *
 * Gated exactly as the demo is, and for the same reason: it renders canned fixtures, so on a real
 * owner's deployment it would be a page of invented receipts sitting beside their real ones.
 */
export const metadata = { title: "The kit, every state" };

export default function KitPage() {
  if (!isDemo(process.env)) {
    notFound();
  }
  return <KitGallery />;
}
