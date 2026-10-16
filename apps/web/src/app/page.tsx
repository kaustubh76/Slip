import { Roll } from "@slip/ui";

/** Until the owner signs in, the roll is blank paper. */
export default function Home() {
  return <Roll entries={[]} hrefFor={(entry) => `/receipts/${entry.view.receiptId}`} />;
}
