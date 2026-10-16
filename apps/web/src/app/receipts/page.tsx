import { listReceipts, pendingHolds } from "@slip/app";
import { HoldsTray, Roll, type RollEntry } from "@slip/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "../../server/owner";

export const dynamic = "force-dynamic";

/**
 * The roll: what is waiting for the owner, then every receipt newest first. Rendered on the
 * server, so the five-second sentence is in the HTML before any script runs; paging is a link,
 * not a handler, for the same reason.
 */
export default async function Receipts({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; agent?: string }>;
}) {
  const { ownerId, mandateId, deps } = await requireOwner();
  const { before, agent } = await searchParams;
  const [page, waiting] = await Promise.all([
    listReceipts(deps, ownerId, mandateId, {
      ...(before === undefined ? {} : { before }),
      ...(agent === undefined ? {} : { agent }),
    }),
    pendingHolds(deps, ownerId, mandateId),
  ]);
  if (page === null || waiting === null) {
    notFound();
  }
  const olderHref = page.next === null ? undefined : hrefFor({ before: page.next, agent });
  return (
    <>
      <HoldsTray entries={waiting} hrefFor={receiptHref} now={Date.now()} Link={Link} />
      {before === undefined ? null : (
        <p>
          <Link href={hrefFor({ agent })} className="slip-link">
            ← Back to the newest receipts
          </Link>
        </p>
      )}
      <Roll
        entries={page.rows}
        hrefFor={receiptHref}
        Link={Link}
        hasOlder={page.next !== null}
        {...(olderHref === undefined ? {} : { olderHref })}
      />
    </>
  );
}

const receiptHref = (entry: RollEntry) => `/receipts/${entry.view.receiptId}`;

function hrefFor(query: { before?: string | undefined; agent?: string | undefined }): string {
  const params = new URLSearchParams();
  if (query.agent !== undefined) {
    params.set("agent", query.agent);
  }
  if (query.before !== undefined) {
    params.set("before", query.before);
  }
  const search = params.toString();
  return search === "" ? "/receipts" : `/receipts?${search}`;
}
