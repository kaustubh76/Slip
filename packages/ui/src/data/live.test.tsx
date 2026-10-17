import { stampToken } from "@slip/domain";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LiveBadge } from "../components/LiveBadge.js";
import { type SlipClient, SlipClientError } from "./client.js";
import type { SlipCommands } from "./commands.js";
import { slipKeys } from "./keys.js";
import { movedCounters, STAMP_COUNTERS, useLive } from "./live.js";
import { type SlipEvent, SlipProvider } from "./provider.js";
import { createSlipQueryClient } from "./query-client.js";

const token = (attempts: number, policy = 1) => `${attempts}.0.0.0.${policy}.1.0.1.0`;

/** A client whose stamp answers from a script; the last answer repeats. */
function stampClient(answers: Array<string | Error>): SlipClient & { reads: number } {
  const unused = async () => {
    throw new Error("unused");
  };
  const client = {
    reads: 0,
    receipts: unused,
    receipt: unused,
    holds: unused,
    agents: unused,
    policies: unused,
    mandate: unused,
    stamp: async () => {
      const answer = answers[Math.min(client.reads, answers.length - 1)];
      client.reads += 1;
      if (answer instanceof Error) {
        throw answer;
      }
      return answer ?? "";
    },
    commands: {} as SlipCommands,
  };
  return client;
}

function setup(client: SlipClient, onEvent?: (e: SlipEvent) => void) {
  const queryClient = createSlipQueryClient();
  const invalidated: string[] = [];
  const original = queryClient.invalidateQueries.bind(queryClient);
  queryClient.invalidateQueries = ((filters, options) => {
    invalidated.push(JSON.stringify(filters?.queryKey));
    return original(filters, options);
  }) as typeof queryClient.invalidateQueries;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SlipProvider client={client} queryClient={queryClient} {...(onEvent ? { onEvent } : {})}>
      {children}
    </SlipProvider>
  );
  return { wrapper, invalidated };
}

describe("movedCounters", () => {
  it("names the counters that moved", () => {
    expect(movedCounters(token(1), token(2))).toEqual(["attempts"]);
    expect(movedCounters(token(1, 1), token(2, 2))).toEqual(["attempts", "policyVersion"]);
    expect(movedCounters(token(1), token(1))).toEqual([]);
    // A token it cannot read moves everything, so nothing is missed.
    expect(movedCounters("1.2", token(1))).toEqual([...STAMP_COUNTERS]);
  });

  it("reads the counters in the order the domain writes them", () => {
    const stamp = Object.fromEntries(STAMP_COUNTERS.map((name, i) => [name, i + 10]));
    expect(stampToken(stamp as never)).toBe(STAMP_COUNTERS.map((_, i) => i + 10).join("."));
  });
});

describe("useLive", () => {
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("refreshes exactly what a moved counter affects, and tells the host", async () => {
    const events: SlipEvent[] = [];
    const client = stampClient([token(1), token(1), token(2)]);
    const { wrapper, invalidated } = setup(client, (e) => events.push(e));
    const { result } = renderHook(() => useLive({ initialToken: token(1), everyMs: 10 }), {
      wrapper,
    });
    await waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toMatchObject({ type: "changed", moved: ["attempts"], token: token(2) });
    await waitFor(() => expect(invalidated.length).toBeGreaterThan(0));
    expect(invalidated.sort()).toEqual(
      [slipKeys.receiptsAll, slipKeys.holds, slipKeys.mandate, slipKeys.agents]
        .map((k) => JSON.stringify(k))
        .sort(),
    );
    expect(result.current.mode).toBe("live");
    expect(result.current.lastChangeAt).not.toBeNull();
  });

  it("catches a change made between the server's render and the first look", async () => {
    const events: SlipEvent[] = [];
    const client = stampClient([token(5)]);
    const { wrapper } = setup(client, (e) => events.push(e));
    renderHook(() => useLive({ initialToken: token(4), everyMs: 10 }), { wrapper });
    await waitFor(() => expect(events).toHaveLength(1));
  });

  it("turns a burst of changes into one round of reads", async () => {
    const client = stampClient([token(1), token(2), token(3), token(4)]);
    const { wrapper, invalidated } = setup(client);
    renderHook(() => useLive({ initialToken: token(1), everyMs: 10 }), { wrapper });
    await waitFor(() => expect(invalidated.length).toBeGreaterThan(0), { timeout: 2_000 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const receipts = invalidated.filter((k) => k === JSON.stringify(slipKeys.receiptsAll));
    expect(receipts).toHaveLength(1);
  });

  it("rests while the tab is hidden and looks at once when it is shown again", async () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    const client = stampClient([token(1)]);
    const { wrapper } = setup(client);
    renderHook(() => useLive({ everyMs: 10 }), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(client.reads).toBe(0);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(client.reads).toBeGreaterThan(0));
  });

  it("stops when signed out, and says offline while Slip cannot be reached", async () => {
    const signedOut = stampClient([new SlipClientError("signed-out", 401, "no session")]);
    const out = renderHook(() => useLive({ everyMs: 10 }), { wrapper: setup(signedOut).wrapper });
    await waitFor(() => expect(out.result.current.mode).toBe("signed-out"));
    const reads = signedOut.reads;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(signedOut.reads).toBe(reads);

    const flaky = stampClient([new SlipClientError("server", 500, "boom"), token(1)]);
    const back = renderHook(() => useLive({ everyMs: 10 }), { wrapper: setup(flaky).wrapper });
    await waitFor(() => expect(flaky.reads).toBeGreaterThan(1));
    await waitFor(() => expect(back.result.current.mode).toBe("live"));
  });
});

describe("LiveBadge", () => {
  it("says how current the page is, in words", async () => {
    const client = stampClient([new SlipClientError("server", 503, "down")]);
    render(<LiveBadge everyMs={10} />, { wrapper: setup(client).wrapper });
    await waitFor(() => expect(screen.getByText("offline · reconnecting")).toBeDefined());
  });
});
