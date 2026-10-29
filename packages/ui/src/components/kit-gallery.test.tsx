import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FakeSlipClient } from "../fake.js";
import { KitGallery } from "./KitGallery.js";

/**
 * The gallery, rendered. It is the one test that mounts every piece of the kit at once, so a prop
 * that stops matching its component, or a seed that stops satisfying a schema, fails here before
 * anyone opens a page.
 */

const NOW = Date.parse("2026-10-29T12:00:00.000Z");

/**
 * Mounting every component of the kit at once is by a wide margin the heaviest render in this
 * repository, and under a full parallel suite it does not fit the default 5 s. The budget is the
 * price of the one test that proves the whole kit still composes.
 */
const MOUNTS_EVERYTHING = 30_000;

describe("the kit gallery", () => {
  it(
    "draws every component, labelled, over a Slip with nothing behind it",
    () => {
      render(<KitGallery slip={new FakeSlipClient()} now={NOW} />);
      for (const of of [
        "Stamp",
        "OutcomeBar",
        "OutcomeFilter",
        "RollSummary",
        "StatusLine",
        "Countdown",
        "GapScale",
        "Leaders",
        "CopyButton",
        "LiveBadge",
        "HoldsTray",
        "Roll",
        "ReceiptSlip",
        "ReportCard",
      ]) {
        expect(screen.getByRole("region", { name: of })).toBeTruthy();
      }
    },
    MOUNTS_EVERYTHING,
  );

  it(
    "shows each state of a stamp, which is what a gallery is for",
    () => {
      render(<KitGallery slip={new FakeSlipClient()} now={NOW} />);
      const stamps = screen.getByRole("region", { name: "Stamp" });
      for (const word of ["PAID", "REJECTED", "HELD", "VOID"]) {
        expect(stamps.textContent).toContain(word);
      }
    },
    MOUNTS_EVERYTHING,
  );

  it(
    "draws the empty states beside the full ones",
    () => {
      // An empty tray and a summary with nothing in it are states a running app reaches only on its
      // first day, which is exactly why they are the ones that rot.
      render(<KitGallery slip={new FakeSlipClient()} now={NOW} />);
      const summary = screen.getByRole("region", { name: "RollSummary" });
      expect(summary.textContent).toContain("yet");
    },
    MOUNTS_EVERYTHING,
  );

  it(
    "asks the fake for nothing it was not shown",
    () => {
      // The gallery renders from the seed directly; the client is there for the hooks. If this starts
      // failing, something in the kit began reading on mount that did not before.
      const slip = new FakeSlipClient();
      render(<KitGallery slip={slip} now={NOW} />);
      expect(slip.calls.filter((call) => call !== "stamp")).toEqual([]);
    },
    MOUNTS_EVERYTHING,
  );
});
