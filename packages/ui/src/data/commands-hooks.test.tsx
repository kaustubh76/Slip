import type { ReceiptDetail } from "@slip/receipt";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { heldView, paidView } from "../seed/views.js";
import { createSlipClient } from "./client.js";
import type { SlipCommands } from "./commands.js";
import { useAgentKeys, useHoldDecision, useUpdateLimits } from "./commands-hooks.js";
import { slipKeys } from "./keys.js";
import { SlipProvider } from "./provider.js";
import { createSlipQueryClient } from "./query-client.js";

const agent = { id: "agent-1", name: "shopper-1" };
const detail = (view: ReturnType<typeof heldView>): ReceiptDetail => ({
  view,
  agent,
  parent: null,
  followUp: null,
  timeline: [],
  offers: [],
});

/** Commands that record their calls; `approve` answers whatever the test sets. */
function recorder(overrides: Partial<SlipCommands> = {}) {
  const calls: string[] = [];
  const commands: SlipCommands = {
    previewApproval: async (id) => {
      calls.push(`preview ${id}`);
      return { status: "preview", kind: "capture", amountCents: 23_900, store: "Store K" };
    },
    approveHold: async (id, cents) => {
      calls.push(`approve ${id} ${cents}`);
      return { status: "done", view: paidView(), followUp: null };
    },
    declineHold: async (id) => {
      calls.push(`decline ${id}`);
      return { status: "done", view: paidView(), followUp: null };
    },
    updateLimits: async () => ({ status: "updated", version: 2 }),
    revokeMandate: async () => ({ status: "unknown" }),
    issueKey: async (name) => ({ status: "issued", name, apiKey: "slip_live_secret123" }),
    revokeKey: async () => ({ status: "revoked" }),
    ...overrides,
  };
  return { commands, calls };
}

function setup(commands: SlipCommands, receipt: () => ReceiptDetail = () => detail(heldView())) {
  const queryClient = createSlipQueryClient();
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("/api/v1/receipts/")) {
      return Response.json(receipt());
    }
    return Response.json({}, { status: 404 });
  }) as typeof globalThis.fetch;
  const client = createSlipClient({ fetch, commands });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SlipProvider client={client} queryClient={queryClient}>
      {children}
    </SlipProvider>
  );
  return { queryClient, wrapper };
}

describe("useHoldDecision", () => {
  it("previews only when asked: a preview can price the item again", async () => {
    const { commands, calls } = recorder();
    const { wrapper } = setup(commands);
    const { result } = renderHook(() => useHoldDecision("h-1"), { wrapper });
    expect(calls).toEqual([]);
    await act(() => result.current.loadPreview());
    expect(calls).toEqual(["preview h-1"]);
    expect(result.current.preview).toMatchObject({ amountCents: 23_900, store: "Store K" });
  });

  it("sends a decision once however often it is clicked, and changes nothing before the answer", async () => {
    let answer: (value: Awaited<ReturnType<SlipCommands["approveHold"]>>) => void = () => {};
    const { commands, calls } = recorder({
      approveHold: (id, cents) => {
        calls.push(`approve ${id} ${cents}`);
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    });
    const { queryClient, wrapper } = setup(commands);
    queryClient.setQueryData(slipKeys.receipt("h-1"), detail(heldView()));
    const { result } = renderHook(() => useHoldDecision("h-1"), { wrapper });
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.approve(23_900);
      void result.current.approve(23_900);
      void result.current.approve(23_900);
    });
    expect(calls).toEqual(["approve h-1 23900"]);
    expect(result.current.status).toBe("busy");
    // Not optimistic: the cached receipt still says what the server last said.
    expect(
      queryClient.getQueryData<ReceiptDetail>(slipKeys.receipt("h-1"))?.view.hold?.status,
    ).toBe("PENDING");
    await act(async () => {
      answer({ status: "done", view: paidView(), followUp: null });
      await first;
    });
    expect(result.current.status).toBe("idle");
    expect(result.current.decided?.status).toBe("done");
  });

  it("a lost answer is unknown, and the receipt is read until the decision shows", async () => {
    let decided = false;
    const { commands, calls } = recorder({
      approveHold: async (id, cents) => {
        calls.push(`approve ${id} ${cents}`);
        decided = true;
        throw new TypeError("the network went away");
      },
    });
    const approvedHold = {
      ...heldView("CAPTURING"),
      hold: { ...heldView().hold, status: "APPROVED" },
    };
    const settled = {
      ...paidView(),
      hold: approvedHold.hold,
    } as ReturnType<typeof heldView>;
    const { wrapper } = setup(commands, () => detail(decided ? settled : heldView()));
    const { result } = renderHook(() => useHoldDecision("h-1"), { wrapper });
    await act(() => result.current.approve(23_900));
    expect(result.current.status).toBe("unknown");
    await waitFor(() => expect(result.current.status).toBe("idle"), { timeout: 3_000 });
    // Never sent a second time.
    expect(calls.filter((c) => c.startsWith("approve"))).toHaveLength(1);
  });

  it("a refusal is shown as it came, with the new amount for a price change", async () => {
    const { commands } = recorder({
      approveHold: async () => ({
        status: "refused",
        reason: "PRICE_CHANGED",
        message: "The price changed since you looked.",
        amountCents: 24_400,
      }),
    });
    const { wrapper } = setup(commands);
    const { result } = renderHook(() => useHoldDecision("h-1"), { wrapper });
    await act(() => result.current.approve(23_900));
    expect(result.current.refusal).toMatchObject({ reason: "PRICE_CHANGED", amountCents: 24_400 });
    expect(result.current.status).toBe("idle");
  });
});

describe("useUpdateLimits", () => {
  it("answers with the new version", async () => {
    const { commands } = recorder();
    const { wrapper } = setup(commands);
    const { result } = renderHook(() => useUpdateLimits(), { wrapper });
    await act(async () => {
      await result.current.save(
        {
          maxOverpayPct: 5,
          maxOverpayDollars: 8,
          flagPct: 1,
          orderCapDollars: 300,
          snapshotMaxAgeMinutes: 10,
        },
        1,
      );
    });
    expect(result.current.answer).toEqual({ status: "updated", version: 2 });
  });
});

describe("useAgentKeys", () => {
  it("shows an issued key once, and never puts it in the query cache", async () => {
    const { commands } = recorder();
    const { queryClient, wrapper } = setup(commands);
    const { result } = renderHook(() => useAgentKeys(), { wrapper });
    await act(async () => {
      await result.current.issue("scout");
    });
    expect(result.current.issued).toEqual({
      status: "issued",
      name: "scout",
      apiKey: "slip_live_secret123",
    });
    const cache = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
    );
    expect(cache).not.toContain("slip_live_secret123");
    act(() => result.current.dismiss());
    expect(result.current.issued).toBeNull();
  });
});
