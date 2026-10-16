import { requireOwner } from "../../server/owner";

export const dynamic = "force-dynamic";

/** The roll. Filled in by the next commit; for now it proves the session reaches a page. */
export default async function Receipts() {
  const { mandateId } = await requireOwner();
  return (
    <article className="slip-sheet" data-perforated="">
      <p className="slip-meta">Receipts · mandate {mandateId.slice(0, 8)}</p>
      <p className="slip-sentence">Signed in.</p>
    </article>
  );
}
