"use client";

import type {
  AgentCard,
  Holds,
  MandateSummary,
  PolicyView,
  ReceiptDetail,
  ReceiptPage,
  ReceiptRow,
} from "@slip/receipt";
import { type InfiniteData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { slipKeys } from "./keys.js";
import { useSlip } from "./provider.js";

/** `enabled: false` holds a query back (signed out, say) without unmounting the component. */
export interface QueryOptions {
  enabled?: boolean;
}

/** How many pages the roll keeps live; older ones are reached through the URL. */
export const LIVE_PAGES = 3;
/** How long a receipt that just printed is marked fresh (the print and the stamp press). */
const FRESH_MS = 4_000;

export interface ReceiptsState {
  /** The receipts on show, newest first. */
  rows: ReceiptRow[];
  /** Receipts that printed just now, for the print animation. */
  fresh: ReadonlySet<string>;
  /** Receipts that arrived while the reader was scrolled down, waiting behind the pill. */
  newAbove: number;
  /** Prints the waiting receipts at the top. */
  revealNew(): void;
  hasOlder: boolean;
  loadOlder(): void;
  loadingOlder: boolean;
  /** Past the live pages: the cursor for a link to older receipts (`?before=`). */
  olderCursor: string | null;
  status: "loading" | "ready" | "error";
  error: Error | null;
}

const byDefaultAtTop = () => typeof window === "undefined" || window.scrollY < 80;

/**
 * The roll. New receipts are never inserted above the reader: at the top of the page they print in
 * place; scrolled down, they wait behind the "N new receipts" pill until revealed — so the page
 * never jumps (Safari has no scroll anchoring to save it).
 */
export function useReceipts(
  options: { agent?: string | null; atTop?: () => boolean } = {},
): ReceiptsState {
  const { client } = useSlip();
  const agent = options.agent ?? null;
  const atTop = options.atTop ?? byDefaultAtTop;
  const query = useInfiniteQuery<
    ReceiptPage,
    Error,
    InfiniteData<ReceiptPage, string | null>,
    ReturnType<typeof slipKeys.receipts>,
    string | null
  >({
    queryKey: slipKeys.receipts(agent),
    queryFn: ({ pageParam, signal }) => client.receipts({ before: pageParam, agent }, signal),
    initialPageParam: null,
    getNextPageParam: (last) => last.next,
  });

  const pages = query.data?.pages ?? [];
  const firstPage = pages[0]?.rows ?? [];
  const allRows = useMemo(() => pages.flatMap((page) => page.rows), [pages]);

  // Receipts seen so far (only a first-page receipt not yet seen can be held back), the ones
  // waiting behind the pill, and the ones that just printed. A different filter starts afresh.
  const seen = useRef<{ agent: string | null; ids: Set<string> } | null>(null);
  const [waiting, setWaiting] = useState<string[]>([]);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  if (seen.current !== null && seen.current.agent !== agent) {
    seen.current = null;
  }

  useEffect(() => {
    if (query.data === undefined) {
      return;
    }
    if (seen.current === null) {
      seen.current = { agent, ids: new Set(allRows.map((r) => r.view.receiptId)) };
      setWaiting([]);
      return;
    }
    const known = seen.current.ids;
    for (const row of allRows.slice(firstPage.length)) {
      known.add(row.view.receiptId);
    }
    const arrivals = firstPage
      .map((r) => r.view.receiptId)
      .filter((id) => !known.has(id) && !waiting.includes(id));
    if (arrivals.length === 0) {
      return;
    }
    if (atTop()) {
      for (const id of arrivals) {
        known.add(id);
      }
      setFresh(new Set(arrivals));
    } else {
      setWaiting((now) => [...now, ...arrivals]);
    }
  }, [query.data, allRows, firstPage, waiting, atTop, agent]);

  useEffect(() => {
    if (fresh.size === 0) {
      return;
    }
    const timer = setTimeout(() => setFresh(new Set()), FRESH_MS);
    return () => clearTimeout(timer);
  }, [fresh]);

  const revealNew = useCallback(() => {
    const known = seen.current?.ids;
    if (known === undefined || waiting.length === 0) {
      return;
    }
    for (const id of waiting) {
      known.add(id);
    }
    setFresh(new Set(waiting));
    setWaiting([]);
  }, [waiting]);

  const held = new Set(waiting);
  const known = seen.current?.ids;
  const top = atTop();
  // Receipts that arrived since the last render: printed now if the reader is at the top (the
  // effect then records them), held back otherwise (the effect then adds them to the pill).
  const arriving =
    known === undefined
      ? []
      : firstPage.map((r) => r.view.receiptId).filter((id) => !known.has(id) && !held.has(id));
  const rows = allRows.filter((row, index) => {
    const id = row.view.receiptId;
    if (known === undefined || index >= firstPage.length) {
      return true;
    }
    if (held.has(id)) {
      return false;
    }
    return known.has(id) || top;
  });
  const freshNow = top && arriving.length > 0 ? new Set([...fresh, ...arriving]) : fresh;

  const atLimit = pages.length >= LIVE_PAGES;
  const lastNext = pages.at(-1)?.next ?? null;
  return {
    rows,
    fresh: freshNow,
    newAbove: waiting.length,
    revealNew,
    hasOlder: query.hasNextPage && !atLimit,
    loadOlder: () => {
      if (!atLimit && !query.isFetchingNextPage) {
        void query.fetchNextPage();
      }
    },
    loadingOlder: query.isFetchingNextPage,
    olderCursor: atLimit ? lastNext : null,
    status: query.status === "pending" ? "loading" : query.status === "error" ? "error" : "ready",
    error: query.error,
  };
}

export function useReceipt(id: string, options: QueryOptions = {}) {
  const { client } = useSlip();
  return useQuery<ReceiptDetail, Error>({
    queryKey: slipKeys.receipt(id),
    enabled: options.enabled ?? true,
    queryFn: ({ signal }) => client.receipt(id, signal),
  });
}

export function useHolds(options: QueryOptions = {}) {
  const { client } = useSlip();
  return useQuery<Holds, Error>({
    queryKey: slipKeys.holds,
    enabled: options.enabled ?? true,
    queryFn: ({ signal }) => client.holds(signal),
  });
}

export function useAgents(options: QueryOptions = {}) {
  const { client } = useSlip();
  return useQuery<AgentCard[], Error>({
    queryKey: slipKeys.agents,
    enabled: options.enabled ?? true,
    queryFn: ({ signal }) => client.agents(signal),
  });
}

/** One agent's report card, from the agents' list. */
export function useReport(agentId: string): AgentCard | null {
  const agents = useAgents();
  return agents.data?.find((card) => card.agent.id === agentId) ?? null;
}

export function usePolicies(options: QueryOptions = {}) {
  const { client } = useSlip();
  return useQuery<PolicyView[], Error>({
    queryKey: slipKeys.policies,
    enabled: options.enabled ?? true,
    queryFn: ({ signal }) => client.policies(signal),
  });
}

export function useMandate(options: QueryOptions = {}) {
  const { client } = useSlip();
  return useQuery<MandateSummary, Error>({
    queryKey: slipKeys.mandate,
    enabled: options.enabled ?? true,
    queryFn: ({ signal }) => client.mandate(signal),
  });
}
