import type { ReceiptRow } from "@slip/receipt";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeSlipClient } from "../fake.js";
import { paidView } from "../seed/views.js";
import { useClock } from "./clock.js";
import { slipKeys } from "./keys.js";
import { SlipProvider } from "./provider.js";
import { createSlipQueryClient } from "./query-client.js";
import { useReceipts } from "./reads.js";

const row = (n: number, agent = "agent-1"): ReceiptRow => ({
  view: { ...paidView(), receiptId: `r-${n}` },
  agent: { id: agent, name: agent },
});

function setup(rows: ReceiptRow[], size = 25) {
  const queryClient = createSlipQueryClient();
  // A whole Slip over these rows: the server's page size is the server's to choose, so it is
  // scripted here rather than asked for by the hook.
  const client = new FakeSlipClient({ rows }).pageSize(size);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SlipProvider client={client} queryClient={queryClient}>
      {children}
    </SlipProvider>
  );
  return { queryClient, wrapper };
}

const ids = (rows: ReceiptRow[]) => rows.map((r) => r.view.receiptId);

describe("useReceipts", () => {
  it("prints a new receipt in place when the reader is at the top", async () => {
    const rows = [row(2), row(1)];
    const { queryClient, wrapper } = setup(rows);
    const { result } = renderHook(() => useReceipts({ atTop: () => true }), { wrapper });
    await waitFor(() => expect(ids(result.current.rows)).toEqual(["r-2", "r-1"]));
    expect(result.current.fresh.size).toBe(0);

    rows.unshift(row(3));
    await act(() => queryClient.invalidateQueries({ queryKey: slipKeys.receiptsAll }));
    await waitFor(() => expect(ids(result.current.rows)).toEqual(["r-3", "r-2", "r-1"]));
    expect([...result.current.fresh]).toEqual(["r-3"]);
    expect(result.current.newAbove).toBe(0);
  });

  it("holds new receipts behind the pill while the reader is scrolled down", async () => {
    const rows = [row(2), row(1)];
    const { queryClient, wrapper } = setup(rows);
    const { result } = renderHook(() => useReceipts({ atTop: () => false }), { wrapper });
    await waitFor(() => expect(ids(result.current.rows)).toEqual(["r-2", "r-1"]));

    rows.unshift(row(3));
    await act(() => queryClient.invalidateQueries({ queryKey: slipKeys.receiptsAll }));
    await waitFor(() => expect(result.current.newAbove).toBe(1));
    // Nothing is inserted above the reader.
    expect(ids(result.current.rows)).toEqual(["r-2", "r-1"]);

    act(() => result.current.revealNew());
    expect(ids(result.current.rows)).toEqual(["r-3", "r-2", "r-1"]);
    expect([...result.current.fresh]).toEqual(["r-3"]);
    expect(result.current.newAbove).toBe(0);
  });

  it("keeps three pages live, then hands over a cursor for older receipts", async () => {
    const rows = [7, 6, 5, 4, 3, 2, 1].map((n) => row(n));
    const { wrapper } = setup(rows, 2);
    const { result } = renderHook(() => useReceipts({ atTop: () => false }), { wrapper });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.hasOlder).toBe(true);
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    // Older pages are history, never held back as "new".
    expect(result.current.newAbove).toBe(0);
    act(() => result.current.loadOlder());
    await waitFor(() => expect(result.current.rows).toHaveLength(6));
    expect(result.current.hasOlder).toBe(false);
    expect(result.current.olderCursor).toBe("r-2");
  });

  it("a different agent filter starts afresh instead of treating every receipt as new", async () => {
    const rows = [row(3, "agent-2"), row(2), row(1, "agent-2")];
    const { wrapper } = setup(rows, 2);
    const { result, rerender } = renderHook(
      ({ agent }: { agent: string | null }) => useReceipts({ agent, atTop: () => false }),
      { wrapper, initialProps: { agent: null as string | null } },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    rerender({ agent: "agent-2" });
    await waitFor(() => expect(ids(result.current.rows)).toEqual(["r-3", "r-1"]));
    expect(result.current.newAbove).toBe(0);
  });
});

describe("useClock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks on one shared timer, and starts from the server's time on hydration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T12:00:00Z"));
    const { result } = renderHook(() => useClock(1_000));
    const start = result.current;
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(result.current - start).toBe(3_000);
  });
});
