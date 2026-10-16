import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  approvedByFollowUpView,
  heldView,
  paidView,
  rejectedView,
  releasedView,
} from "../__fixtures__/views.js";
import { Leaders } from "./Leaders.js";
import { ReceiptSlip } from "./ReceiptSlip.js";
import { Stamp } from "./Stamp.js";
import { StatusLine } from "./StatusLine.js";

describe("Stamp", () => {
  it("says its verdict in words and carries its shape as data, never colour alone", () => {
    render(<Stamp kind="REJECTED" />);
    const stamp = screen.getByRole("img", { name: "Outcome: rejected" });
    expect(stamp.textContent).toBe("REJECTED");
    expect(stamp.dataset["outcome"]).toBe("REJECTED");
  });
});

describe("Stamp labels", () => {
  it("says what it marks: an outcome by default, something else when told", () => {
    const { rerender } = render(<Stamp kind="VOID" label="CANCELLED" />);
    expect(screen.getByRole("img", { name: "Outcome: cancelled" })).toBeDefined();
    rerender(<Stamp kind="VOID" label="IN FORCE" describedAs="This permission is in force" />);
    expect(screen.getByRole("img", { name: "This permission is in force" })).toBeDefined();
  });
});

describe("StatusLine", () => {
  it("announces a line PayPal is still working on, and not a settled one", () => {
    const { container, rerender } = render(<StatusLine state={heldView("CAPTURING").state} />);
    const line = container.querySelector(".slip-status");
    expect(line?.getAttribute("aria-live")).toBe("polite");
    expect(line?.textContent).toMatch(
      /^\[ \] CAPTURING · You approved at 14:05 UTC\. Collecting \$239\.00\.$/,
    );
    rerender(<StatusLine state={paidView().state} />);
    expect(container.querySelector(".slip-status")?.getAttribute("aria-live")).toBeNull();
  });
});

describe("ReceiptSlip", () => {
  it("prints the spec's receipt word for word, stamped REJECTED, with the cheaper offer one click away", () => {
    const { container } = render(<ReceiptSlip view={rejectedView()} agentName="shopper-1" />);
    const sentences = [...container.querySelectorAll(".slip-sentence")].map((p) => p.textContent);
    expect(sentences).toEqual([
      "Your agent tried to pay $58.99 at Store A.",
      "The same item was listed at $47.99 at Store B.",
      "Overpaid by $11.00 (23%).",
      "Store A pays your agent's platform up to 8% commission; Store B pays up to 2%.",
      "Payment rejected. Nothing was charged.",
    ]);
    expect([...container.querySelectorAll(".slip-amount")].map((s) => s.textContent)).toEqual([
      "$58.99",
      "$47.99",
      "$11.00",
    ]);
    expect(screen.getByRole("img", { name: "Outcome: rejected" })).toBeDefined();
    const link = screen.getByRole("link", { name: "Open the $47.99 offer at Store B →" });
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    const slip = screen.getByRole("article");
    expect(slip.dataset).toMatchObject({
      slipOutcome: "REJECTED",
      slipRule: "R4_OVERPAID",
      slipPayment: "NONE",
      slipHold: "NONE",
    });
    expect(within(slip).getByText(/agent shopper-1/)).toBeDefined();
    expect(container.querySelector(".slip-caption")?.textContent).toContain(
      "+$3.00 past your limit.",
    );
  });

  it("draws the gap scale as decoration: hidden from assistive tech, said in the caption", () => {
    const { container } = render(<ReceiptSlip view={rejectedView()} />);
    const svg = container.querySelector("svg.slip-scale");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
    // The other comparable offer ($52.00) is a tick; the choice sits right of the limit.
    const ticks = container.querySelectorAll("line.slip-scale-tick");
    expect(ticks).toHaveLength(2);
    const chosenX = Number(
      container.querySelector("[data-chosen-x]")?.getAttribute("data-chosen-x"),
    );
    const limitX = Number(ticks[0]?.getAttribute("x1"));
    expect(chosenX).toBeGreaterThan(limitX);
    expect(container.querySelector("figcaption")?.textContent).toContain(
      "Within your limits up to $55.99.",
    );
  });

  it("a paid purchase at the lowest price has no offer link and says it was paid", () => {
    const { container } = render(<ReceiptSlip view={paidView()} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("img", { name: "Outcome: paid" })).toBeDefined();
    expect(container.querySelector(".slip-status")?.textContent).toBe(
      "[x] CAPTURED · Paid $31.50 at Store B.",
    );
  });

  it("a hold let go after a revoke is stamped grey and says who released it", () => {
    const { container } = render(<ReceiptSlip view={releasedView()} />);
    const stamp = screen.getByRole("img", { name: "Outcome: released" });
    expect(stamp.dataset["outcome"]).toBe("VOID");
    expect(container.querySelector(".slip-status")?.textContent).toContain(
      "Released when the mandate was revoked",
    );
  });

  it("an approved hold paid by its follow-up says money moved, and how", () => {
    const { container } = render(<ReceiptSlip view={approvedByFollowUpView()} />);
    expect(container.querySelector(".slip-receipt")?.getAttribute("data-slip-payment")).toBe(
      "CAPTURED",
    );
    expect(container.querySelector(".slip-status")?.textContent).toMatch(
      /Paid \$250\.00 in one step \(follow-up receipt no\. [0-9a-f]{4}…[0-9a-f]{4}\)\./,
    );
  });

  it("puts what is behind the receipt under the tear line", () => {
    const { container } = render(
      <ReceiptSlip view={paidView()} behind={<p>rules behind it</p>}>
        <button type="button">Decide</button>
      </ReceiptSlip>,
    );
    const tear = container.querySelector(".slip-tear");
    expect(tear?.nextElementSibling?.textContent).toBe("rules behind it");
    expect(screen.getByRole("button", { name: "Decide" })).toBeDefined();
  });
});

describe("Leaders", () => {
  it("is a description list underneath the dots", () => {
    const { container } = render(
      <Leaders
        rows={[
          ["Payment", "no PayPal order"],
          ["Policy", "version 3"],
        ]}
      />,
    );
    expect([...container.querySelectorAll("dt")].map((d) => d.textContent)).toEqual([
      "Payment",
      "Policy",
    ]);
    expect(container.querySelectorAll("dd")).toHaveLength(2);
  });
});
