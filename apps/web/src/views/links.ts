import type { RollEntry } from "@slip/ui";

export const receiptHref = (entry: RollEntry): string => `/receipts/${entry.view.receiptId}`;

/** The roll's address with its filter and cursor. */
export function rollHref(query: { before?: string | null; agent?: string | null }): string {
  const params = new URLSearchParams();
  if (query.agent) {
    params.set("agent", query.agent);
  }
  if (query.before) {
    params.set("before", query.before);
  }
  const search = params.toString();
  return search === "" ? "/receipts" : `/receipts?${search}`;
}
