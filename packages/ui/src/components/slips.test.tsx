import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SlipClientError, type SlipClientErrorKind } from "../data/client.js";
import { SlipProvider } from "../data/provider.js";
import { createSlipQueryClient } from "../data/query-client.js";
import { useAgents } from "../data/reads.js";
import { FakeSlipClient } from "../fake.js";
import type { LinkLike } from "./Link.js";
import { ErrorSlip, FeedingPaper } from "./Slips.js";

/**
 * The two states every read has besides the one anyone designs for. Until now neither had a test,
 * which is an odd place for the UI's robustness to rest: six views draw `ErrorSlip` and none of its
 * branches was exercised.
 *
 * The rule it exists to keep is the one asserted hardest here: a reader is told what failed in
 * Slip's own words and is never shown the error's. An exception's message can carry a service's
 * free text, and a service's free text can be written at whoever reads it (D61).
 */

const KINDS: SlipClientErrorKind[] = ["signed-out", "not-found", "server", "invalid"];

const slipError = (kind: SlipClientErrorKind) =>
  new SlipClientError(kind, 500, "RAW DETAIL FROM THE WIRE: Invalid API key sk-leaked");

describe("FeedingPaper", () => {
  it("says what is being read, and that it is busy", () => {
    render(<FeedingPaper label="Receipt" />);
    expect(screen.getByText("Receipt")).toBeTruthy();
    expect(document.querySelector("[aria-busy='true']")).toBeTruthy();
  });
});

describe("ErrorSlip", () => {
  it("sends a signed-out reader to sign in again, and offers no retry", () => {
    render(<ErrorSlip what="your agents" error={slipError("signed-out")} onRetry={() => {}} />);
    expect(screen.getByRole("alert").textContent).toContain("session has ended");
    expect(screen.getByRole("link", { name: /Sign in again/ }).getAttribute("href")).toBe(
      "/sign-in",
    );
    // Trying again cannot help an ended session, so the button is not offered even when passed.
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("says a missing receipt may simply not be theirs", () => {
    render(<ErrorSlip what="this receipt" error={slipError("not-found")} />);
    expect(screen.getByRole("alert").textContent).toContain("not there, or it is not yours");
  });

  it("falls back to one sentence for anything else", () => {
    for (const kind of ["server", "invalid"] as const) {
      const { unmount } = render(<ErrorSlip what="the receipts" error={slipError(kind)} />);
      expect(screen.getByRole("alert").textContent).toContain("could not answer just now");
      expect(screen.getByRole("alert").textContent).toContain("the receipts");
      unmount();
    }
  });

  it("survives a failure the client never classified, and no failure at all", () => {
    // A read can fail for reasons `createSlipClient` does not name — a thrown TypeError, an abort
    // that got through — and a view that is in its error branch must still render something.
    const { unmount } = render(<ErrorSlip what="the in-tray" error={new Error("boom")} />);
    expect(screen.getByRole("alert").textContent).toContain("could not answer just now");
    unmount();
    render(<ErrorSlip what="the in-tray" error={null} />);
    expect(screen.getByRole("alert").textContent).toContain("could not answer just now");
  });

  it("never shows the error's own words, whatever kind it is", () => {
    for (const kind of KINDS) {
      const { unmount } = render(<ErrorSlip what="your limits" error={slipError(kind)} />);
      const page = document.body.textContent ?? "";
      expect(page).not.toContain("RAW DETAIL");
      expect(page).not.toContain("sk-leaked");
      expect(page).not.toContain("Invalid API key");
      expect(page).not.toMatch(/\bError\b/);
      expect(page).not.toContain("at ");
      unmount();
    }
  });

  it("offers a retry only when there is something to retry with", () => {
    const retry = vi.fn();
    const { unmount } = render(
      <ErrorSlip what="your agents" error={slipError("server")} onRetry={retry} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    unmount();
    render(<ErrorSlip what="your agents" error={slipError("server")} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("uses the host's link when it has one, and a plain anchor when it does not", () => {
    const Hosted: LinkLike = ({ href, children }) => (
      <a href={href} data-hosted="">
        {children}
      </a>
    );
    const { unmount } = render(
      <ErrorSlip what="x" error={slipError("signed-out")} Link={Hosted} />,
    );
    expect(document.querySelector("[data-hosted]")).toBeTruthy();
    unmount();
    render(<ErrorSlip what="x" error={slipError("signed-out")} />);
    expect(document.querySelector("[data-hosted]")).toBeNull();
    expect(screen.getByRole("link", { name: /Sign in again/ })).toBeTruthy();
  });
});

/** One view's worth of wiring: the real hook, the real slip, the real query client. */
function Agents() {
  const agents = useAgents();
  if (agents.isError) {
    return (
      <ErrorSlip what="your agents" error={agents.error} onRetry={() => void agents.refetch()} />
    );
  }
  return <p>{agents.data === undefined ? "reading" : `${agents.data.length} agents`}</p>;
}

const mounted = (client: FakeSlipClient): ReactNode => (
  <SlipProvider client={client} queryClient={createSlipQueryClient()}>
    <Agents />
  </SlipProvider>
);

describe("a read that fails, through the hooks", () => {
  it("absorbs a server failure without telling anyone, because that is the policy", async () => {
    // `createSlipQueryClient` retries a server failure twice and nothing else: "being signed out,
    // a missing receipt or a response of the wrong shape will not fix itself". So a transient one
    // must never reach the owner — and `failNext` is one-shot, which makes it transient.
    const client = new FakeSlipClient().failNext("server");
    render(mounted(client));
    await waitFor(() => expect(screen.getByText("2 agents")).toBeTruthy(), { timeout: 10_000 });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(client.asked("agents")).toBe(2);
  }, 15_000);

  it("shows the slip for a failure that will not fix itself, and recovers when retried", async () => {
    // The whole point of the fake: a one-shot failure means a successful retry proves recovery
    // rather than a re-render.
    const client = new FakeSlipClient().failNext("invalid");
    render(mounted(client));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("could not answer just now");
    expect(client.asked("agents")).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByText("2 agents")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
  }, 15_000);

  it("does not retry a signed-out session, and does not offer to", async () => {
    const client = new FakeSlipClient().failNext("signed-out");
    render(mounted(client));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("session has ended");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(client.asked("agents")).toBe(1);
  }, 15_000);
});
