import type {
  AgentCard,
  Holds,
  MandateSummary,
  PolicyView,
  ReceiptDetail,
  ReceiptPage,
} from "@slip/receipt";
import { type DehydratedState, dehydrate, type QueryClient } from "@tanstack/react-query";
import { slipKeys } from "./data/keys.js";
import { createSlipQueryClient } from "./data/query-client.js";

/**
 * For a server render: what the page already read, as the cache state its hooks start from. Make
 * one QueryClient per request (never share one between owners), seed it, dehydrate it, and pass
 * the state to `<SlipHydrate>`.
 */
export interface SlipSeed {
  receipts?: { agent?: string | null; page: ReceiptPage };
  receipt?: ReceiptDetail;
  holds?: Holds;
  agents?: AgentCard[];
  policies?: PolicyView[];
  mandate?: MandateSummary;
}

export function seedSlipQueries(
  seed: SlipSeed,
  client: QueryClient = createSlipQueryClient(),
): DehydratedState {
  if (seed.receipts !== undefined) {
    client.setQueryData(slipKeys.receipts(seed.receipts.agent ?? null), {
      pages: [seed.receipts.page],
      pageParams: [null],
    });
  }
  if (seed.receipt !== undefined) {
    client.setQueryData(slipKeys.receipt(seed.receipt.view.receiptId), seed.receipt);
  }
  if (seed.holds !== undefined) {
    client.setQueryData(slipKeys.holds, seed.holds);
  }
  if (seed.agents !== undefined) {
    client.setQueryData(slipKeys.agents, seed.agents);
  }
  if (seed.policies !== undefined) {
    client.setQueryData(slipKeys.policies, seed.policies);
  }
  if (seed.mandate !== undefined) {
    client.setQueryData(slipKeys.mandate, seed.mandate);
  }
  return dehydrate(client);
}

export { createSlipQueryClient, slipKeys };
