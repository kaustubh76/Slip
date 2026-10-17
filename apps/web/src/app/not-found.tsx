import Link from "next/link";

export const metadata = { title: "Not found · Slip" };

/**
 * Nothing at this address — or something that belongs to another desk, which reads the same: Slip
 * never says whether someone else's receipt exists.
 */
export default function NotFound() {
  return (
    <article className="slip-sheet" data-perforated="">
      <p className="slip-meta">Not found</p>
      <p className="slip-sentence">Nothing is printed at this address.</p>
      <p className="slip-prose">
        A receipt or hold that is not on your desk shows this too: Slip does not say whether it
        exists.
      </p>
      <p>
        <Link href="/receipts" className="slip-link">
          Back to the roll →
        </Link>
      </p>
    </article>
  );
}
