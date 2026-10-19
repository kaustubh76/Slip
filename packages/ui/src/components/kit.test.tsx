import { agentId } from "@slip/domain";
import { testUuid } from "@slip/domain/testing";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { heldView, paidView, rejectedView } from "../__fixtures__/views.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ApproveDialog, DeclineDialog } from "./HoldDialogs.js";
import { HoldsTray } from "./HoldsTray.js";
import { ReportCard, type ReportCardData } from "./ReportCard.js";
import { Roll, type RollEntry } from "./Roll.js";
import { timeLeft } from "./time.js";

const entry = (view: RollEntry["view"], name = "shopper-1"): RollEntry => ({
  view,
  agent: { id: testUuid(), name },
});
const hrefFor = (e: RollEntry) => `/receipts/${e.view.receiptId}`;

describe("Roll", () => {
  it("prints each receipt as a row; a waiting hold sits offset", () => {
    const rows = [entry(rejectedView()), entry(heldView(), "shopper-2"), entry(paidView())];
    const { container } = render(<Roll entries={rows} hrefFor={hrefFor} />);
    const items = container.querySelectorAll("li.slip-row");
    expect(items).toHaveLength(3);
    expect([...items].map((li) => li.hasAttribute("data-cocked"))).toEqual([false, true, false]);
    expect(
      screen.getByRole("link", { name: "Your agent tried to pay $58.99 at Store A." }),
    ).toHaveProperty("href", expect.stringContaining(`/receipts/${rows[0]?.view.receiptId}`));
  });

  it("marks the row whose receipt is open beside it, and only that one", () => {
    const rows = [entry(rejectedView()), entry(heldView(), "shopper-2"), entry(paidView())];
    const openId = rows[1]?.view.receiptId;
    const { container } = render(<Roll entries={rows} hrefFor={hrefFor} openId={openId ?? ""} />);
    const items = container.querySelectorAll("li.slip-row");
    expect([...items].map((li) => li.hasAttribute("data-open"))).toEqual([false, true, false]);
    expect(container.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(container.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe(
      `/receipts/${openId}`,
    );
  });

  it("marks nothing when no receipt is open", () => {
    const { container } = render(<Roll entries={[entry(paidView())]} hrefFor={hrefFor} />);
    expect(container.querySelector("[data-open]")).toBeNull();
    expect(container.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("never pushes new receipts in above the reader: they wait behind a pill", () => {
    const reveal = vi.fn();
    render(
      <Roll entries={[entry(paidView())]} hrefFor={hrefFor} newAbove={1} onRevealNew={reveal} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "1 new receipt printed above" }));
    expect(reveal).toHaveBeenCalledOnce();
  });

  it("an empty roll says where the first receipt will print", () => {
    render(<Roll entries={[]} hrefFor={hrefFor} />);
    expect(
      screen.getByText(
        "No receipts yet. The first one prints here the moment an agent calls checkout.",
      ),
    ).toBeDefined();
  });

  it("asks for older receipts only when there are some", () => {
    const older = vi.fn();
    const { rerender } = render(<Roll entries={[entry(paidView())]} hrefFor={hrefFor} />);
    expect(screen.queryByRole("button", { name: "Older receipts →" })).toBeNull();
    rerender(<Roll entries={[entry(paidView())]} hrefFor={hrefFor} hasOlder onOlder={older} />);
    fireEvent.click(screen.getByRole("button", { name: "Older receipts →" }));
    expect(older).toHaveBeenCalledOnce();
  });
});

describe("HoldsTray", () => {
  it("lists what is waiting with the time left to decide", () => {
    const view = heldView();
    const now = new Date(view.createdAt).getTime() + 5 * 60_000;
    const { container } = render(
      <HoldsTray entries={[entry(view, "shopper-2")]} hrefFor={hrefFor} now={now} />,
    );
    expect(container.querySelector(".slip-tray-row")?.textContent).toBe(
      "14:02 shopper-2 $239.00 at Store A above cap 47h 55m left Decide →",
    );
    expect(screen.getByText("1 hold")).toBeDefined();
  });

  it("an empty tray says so", () => {
    render(<HoldsTray entries={[]} hrefFor={hrefFor} now={0} />);
    expect(
      screen.getByText("Nothing in the tray. Held purchases appear here with 48 hours to decide."),
    ).toBeDefined();
  });

  it.each([
    [48 * 60, "48h 0m left"],
    [12, "12m left"],
    [0.5, "under a minute left"],
    [-1, "expired"],
  ])("%s minutes before expiry reads %s", (minutes, text) => {
    const expiresAt = "2026-10-13T14:02:00.000Z";
    expect(timeLeft(expiresAt, new Date(expiresAt).getTime() - minutes * 60_000)).toBe(text);
  });
});

describe("ConfirmDialog", () => {
  it("a double click confirms once; the answer re-arms it", () => {
    const onConfirm = vi.fn();
    function Harness() {
      const [busy, setBusy] = useState(false);
      return (
        <>
          <ConfirmDialog
            open
            title="Take $239.00?"
            confirmLabel="Approve"
            busy={busy}
            onConfirm={() => {
              onConfirm();
            }}
            onClose={() => {}}
          />
          <button type="button" onClick={() => setBusy((b) => !b)}>
            toggle
          </button>
        </>
      );
    }
    render(<Harness />);
    const approve = screen.getByRole("button", { name: "Approve" });
    fireEvent.click(approve);
    fireEvent.click(approve);
    expect(onConfirm).toHaveBeenCalledOnce();
    // The server answers (busy on, then off): the next decision can be sent.
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });
});

describe("ApproveDialog", () => {
  const capture = { kind: "capture" as const, amountCents: 23_900, store: "Store K" };

  it("names the exact amount and sends exactly that amount back", () => {
    const onApprove = vi.fn();
    render(
      <ApproveDialog
        open
        preview={capture}
        refusal={null}
        status="idle"
        onApprove={onApprove}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe(
      "Take $239.00 from your PayPal for Store K?",
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve and take $239.00" }));
    expect(onApprove).toHaveBeenCalledWith(23_900);
  });

  it("a changed price needs a new confirmation of the new amount", () => {
    const onApprove = vi.fn();
    render(
      <ApproveDialog
        open
        preview={{ kind: "pay", amountCents: 23_900, store: "Store K" }}
        refusal={{ reason: "PRICE_CHANGED", message: "The price changed.", amountCents: 24_400 }}
        status="idle"
        onApprove={onApprove}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("The price changed: $239.00 → $244.00");
    fireEvent.click(screen.getByRole("button", { name: "Approve and pay $244.00" }));
    expect(onApprove).toHaveBeenCalledWith(24_400);
  });

  it("a lost answer is 'Checking with PayPal…', never a failure, and nothing can be resent", () => {
    const { container } = render(
      <ApproveDialog
        open
        preview={capture}
        refusal={null}
        status="unknown"
        onApprove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("Checking with PayPal…");
    expect(container.textContent).not.toMatch(/fail/i);
    expect(
      (screen.getByRole("button", { name: "Approve and take $239.00" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("a hold PayPal has not confirmed cannot be approved yet, and says why", () => {
    render(
      <ApproveDialog
        open
        preview={null}
        refusal={{ reason: "NOT_READY", message: "PayPal has not confirmed the reservation yet." }}
        status="idle"
        onApprove={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "PayPal has not confirmed the reservation yet.",
    );
    expect((screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("while the answer is coming it says what is happening", () => {
    render(
      <ApproveDialog
        open
        preview={capture}
        refusal={null}
        status="busy"
        onApprove={() => {}}
        onClose={() => {}}
      />,
    );
    const busy = screen.getByRole("button", { name: "Taking $239.00…" });
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("DeclineDialog", () => {
  it("says the reserved money is released and nothing is charged", () => {
    const onDecline = vi.fn();
    render(
      <DeclineDialog
        open
        reservedCents={23_900}
        status="idle"
        refusal={null}
        onDecline={onDecline}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("heading").textContent).toBe("Release the $239.00 PayPal is holding?");
    expect(
      screen.getByText("The agent's purchase does not go ahead. Nothing will be charged."),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Decline and release" }));
    expect(onDecline).toHaveBeenCalledOnce();
  });
});

describe("ReportCard", () => {
  const card: ReportCardData = {
    agent: {
      id: testUuid(),
      name: "shopper-1",
      apiKeyPrefix: "slip_live_ab12",
      createdAt: "2026-10-11T14:02:00.000Z",
      revokedAt: "2026-10-12T09:00:00.000Z",
    },
    report: {
      report: {
        agentId: agentId(testUuid()),
        attempted: 12,
        paid: 9,
        rejected: 2,
        held: 1,
        captured: 10,
        notCheapest: 3,
        medianGapPctHundredths: 214,
        worstGapPctHundredths: 2_292,
        worstGapAbsCents: 1_100 as never,
        steered: 1,
        conflicts: 2,
      },
      lines: ["12 purchases checked: 9 paid, 2 rejected, 1 held for the owner."],
    },
  };

  it("shows the numbers on leaders, the key's prefix only, and a revoked agent's stamp", () => {
    const { container } = render(<ReportCard card={card} />);
    const leaders = Object.fromEntries(
      [...container.querySelectorAll(".slip-leaders > div")].map((row) => [
        row.querySelector("dt")?.textContent,
        row.querySelector("dd")?.textContent,
      ]),
    );
    expect(leaders).toMatchObject({
      Attempted: "12",
      "Typical gap": "2.1%",
      "Widest gap": "23% · $11.00",
      "Commission conflicts": "2",
    });
    expect(screen.getByText("key slip_live_ab12…")).toBeDefined();
    expect(screen.getByRole("img", { name: "Outcome: revoked" })).toBeDefined();
    expect(
      screen.getByText("Owner-approved follow-ups are not counted as the agent's choices."),
    ).toBeDefined();
  });
});
