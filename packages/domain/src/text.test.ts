import { describe, expect, it } from "vitest";
import { SHOWN_TEXT_LIMIT, STORED_TEXT_LIMIT, shownText, storedText } from "./text.js";

/**
 * Slip stands between an agent and a store's words, so how much of them it passes on is Slip's
 * answer to give. Two bounds, two jobs: what an agent is handed, and what a row keeps. Neither may
 * cut without saying so — text silently shortened reads as the whole listing and is not.
 */

const long = (n: number) => "word ".repeat(Math.ceil(n / 5)).slice(0, n);

describe("shownText", () => {
  it("leaves a short line alone", () => {
    expect(shownText("A 15-inch cast iron skillet.")).toBe("A 15-inch cast iron skillet.");
  });

  it("puts a description on one line, however the store laid it out", () => {
    // A real Channel3 description arrives with its own newlines and bullet list. The MCP text form
    // quotes it as `about: "…"`, so left alone those bullets look exactly like the tool's own
    // `- store: …` lines and nothing tells them apart.
    expect(shownText("These shoes are great.\n\nVibram outsole\nToe bumper\t\tLow 4mm drop")).toBe(
      "These shoes are great. Vibram outsole Toe bumper Low 4mm drop",
    );
  });

  it("cuts at the limit and says it cut", () => {
    const cut = shownText(long(2_000));
    expect(cut).not.toBeNull();
    // At most the limit plus the mark; shorter when the cut lands on a space, which is trimmed.
    expect((cut ?? "").length).toBeLessThanOrEqual(SHOWN_TEXT_LIMIT + 1);
    expect(cut?.endsWith("…")).toBe(true);
    expect(shownText("x".repeat(2_000))).toHaveLength(SHOWN_TEXT_LIMIT + 1);
  });

  it("is nothing at all for nothing at all", () => {
    expect(shownText(null)).toBeNull();
    expect(shownText(undefined)).toBeNull();
    expect(shownText("   \n\t ")).toBeNull();
  });
});

describe("storedText", () => {
  it("keeps the store's own line breaks, because a row records what the store wrote", () => {
    expect(storedText("A skillet.\nPre-seasoned\n15 inch")).toBe(
      "A skillet.\nPre-seasoned\n15 inch",
    );
  });

  it("bounds a row at a size no real listing reaches, and marks it when it does", () => {
    // The longest description in the study sample is 1,579 characters, so this has never fired on
    // real data: the reason to bound a stored row is a hostile payload, not a wordy merchant.
    expect(storedText(long(1_579))).toHaveLength(1_579);
    const cut = storedText("x".repeat(50_000));
    expect(cut).toHaveLength(STORED_TEXT_LIMIT + 1);
    expect(cut?.endsWith("…")).toBe(true);
  });

  it("is nothing at all for nothing at all", () => {
    expect(storedText(null)).toBeNull();
    expect(storedText("  \n ")).toBeNull();
  });
});

describe("the two bounds together", () => {
  it("agree on what they do, and differ only in where they apply", () => {
    // One mechanism, two numbers, both stated. The shown bound is the smaller one, so a value
    // that has been through both is cut once visibly rather than twice silently.
    expect(SHOWN_TEXT_LIMIT).toBeLessThan(STORED_TEXT_LIMIT);
    const whole = "x".repeat(50_000);
    expect(shownText(storedText(whole) ?? "")).toBe(shownText(whole));
  });
});
