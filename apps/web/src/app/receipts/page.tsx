import { listReceipts } from "@slip/app";
import { Roll } from "@slip/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "../../server/owner";
import { receiptHref, rollHref } from "../../views/links";

export const dynamic = "force-dynamic";

/**
 * The dock, with nothing open in it. The roll beside it belongs to the layout, so this page is
 * only what fills the space until a receipt is picked.
 *
 * Receipts past the live pages are a page of their own, reached by a link: a plain server render
 * with no live connection, which takes the whole bench rather than sitting in the dock.
 */
export default async function Receipts({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; agent?: string }>;
}) {
  const { before, agent } = await searchParams;
  if (before === undefined) {
    return (
      <p className="slip-dock-empty slip-caption">Pick a receipt from the roll to read it here.</p>
    );
  }
  const { ownerId, mandateId, deps } = await requireOwner();
  const page = await listReceipts(deps, ownerId, mandateId, { before, agent: agent ?? null });
  if (page === null) {
    notFound();
  }
  return (
    <div data-archive="">
      <p>
        <Link href={rollHref({ agent: agent ?? null })} className="slip-link">
          ← Back to the newest receipts
        </Link>
      </p>
      <Roll
        entries={page.rows}
        hrefFor={receiptHref}
        Link={Link}
        hasOlder={page.next !== null}
        {...(page.next === null
          ? {}
          : { olderHref: rollHref({ before: page.next, agent: agent ?? null }) })}
      />
    </div>
  );
}
