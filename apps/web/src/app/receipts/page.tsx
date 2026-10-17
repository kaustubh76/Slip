import { agentCards, listReceipts, ownerHolds } from "@slip/app";
import { Roll, SlipHydrate } from "@slip/ui";
import { seedSlipQueries } from "@slip/ui/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { stampTokenFor } from "../../server/live";
import { requireOwner } from "../../server/owner";
import { receiptHref, rollHref } from "../../views/links";
import { ReceiptsView } from "../../views/ReceiptsView";

export const dynamic = "force-dynamic";

/**
 * The roll. The newest receipts are rendered on the server — the five-second sentences are in the
 * HTML before any script runs — and then kept live in the browser. Receipts past the live pages
 * are a plain server page reached by a link.
 */
export default async function Receipts({
  searchParams,
}: {
  searchParams: Promise<{ before?: string; agent?: string }>;
}) {
  const { ownerId, mandateId, deps } = await requireOwner();
  const { before, agent } = await searchParams;
  if (before !== undefined) {
    const page = await listReceipts(deps, ownerId, mandateId, { before, agent: agent ?? null });
    if (page === null) {
      notFound();
    }
    return (
      <>
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
      </>
    );
  }
  // The stamp first, then the data: a change in between is caught on the first live look.
  const token = await stampTokenFor(deps, mandateId);
  const [page, holds, agents] = await Promise.all([
    listReceipts(deps, ownerId, mandateId, { agent: agent ?? null }),
    ownerHolds(deps, ownerId, mandateId),
    agentCards(deps, ownerId, mandateId),
  ]);
  if (page === null || holds === null || agents === null) {
    notFound();
  }
  const state = seedSlipQueries({ receipts: { agent: agent ?? null, page }, holds, agents });
  return (
    <SlipHydrate state={state}>
      <ReceiptsView agent={agent ?? null} token={token} serverNow={Date.now()} />
    </SlipHydrate>
  );
}
