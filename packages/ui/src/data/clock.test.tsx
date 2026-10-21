import { act, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useClock } from "./clock.js";

/** Reads the clock and offers a button that re-renders without changing anything else. */
function Countdown({ everyMs = 1_000 }: { everyMs?: number }) {
  const now = useClock(everyMs);
  const [, bump] = useState(0);
  return (
    <>
      <p data-testid="now">{now}</p>
      <button type="button" onClick={() => bump((n) => n + 1)}>
        bump
      </button>
    </>
  );
}

const reading = () => screen.getByTestId("now").textContent;

describe("useClock", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks every interval", () => {
    render(<Countdown />);
    expect(reading()).toBe("1000000");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(reading()).toBe("1001000");
  });

  /**
   * React resubscribes whenever the subscribe function is a new one. Subscribing a ticker with no
   * listeners left starts it from the current time, so a resubscribe on every render moved the
   * clock on every render — which is a changed snapshot, which is another render (D79).
   */
  it("does not resubscribe when the component renders again", () => {
    const start = vi.spyOn(globalThis, "setInterval");
    render(<Countdown />);
    const subscribed = start.mock.calls.length;
    act(() => {
      screen.getByRole("button").click();
      screen.getByRole("button").click();
      screen.getByRole("button").click();
    });
    expect(start.mock.calls.length).toBe(subscribed);
    start.mockRestore();
  });

  it("does not move between ticks, however often the page renders", () => {
    render(<Countdown />);
    const before = reading();
    // Time passes without the interval firing: a render in between must not read it off the wall.
    vi.setSystemTime(1_000_750);
    act(() => {
      screen.getByRole("button").click();
    });
    expect(reading()).toBe(before);
  });

  it("gives two readers at the same interval the one ticker", () => {
    const start = vi.spyOn(globalThis, "setInterval");
    render(
      <>
        <Countdown />
        <Countdown />
      </>,
    );
    expect(start.mock.calls.length).toBe(1);
    start.mockRestore();
  });
});
