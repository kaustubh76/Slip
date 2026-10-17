import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CHORD_MS,
  createShortcutResolver,
  type ShortcutAction,
  useShortcuts,
} from "./shortcuts.js";

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {},
) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});
const free = { typing: false, dialogOpen: false };

describe("shortcut keys", () => {
  it("maps single keys, and g then a letter to a page", () => {
    let t = 0;
    const resolve = createShortcutResolver(() => t);
    expect(resolve(key("j"), free)).toEqual({ kind: "next" });
    expect(resolve(key("d"), free)).toEqual({ kind: "decline" });
    expect(resolve(key("?"), free)).toEqual({ kind: "help" });
    expect(resolve(key("g"), free)).toBeNull();
    t += 300;
    expect(resolve(key("h"), free)).toEqual({ kind: "go", to: "holds" });
    // After the chord, "a" is approve again, not "go to agents".
    expect(resolve(key("a"), free)).toEqual({ kind: "approve" });
  });

  it("lets a slow second key, a modifier, typing or an open dialog through untouched", () => {
    let t = 0;
    const resolve = createShortcutResolver(() => t);
    resolve(key("g"), free);
    t += CHORD_MS + 1;
    expect(resolve(key("h"), free)).toBeNull();
    expect(resolve(key("j", { metaKey: true }), free)).toBeNull();
    expect(resolve(key("j"), { typing: true, dialogOpen: false })).toBeNull();
    expect(resolve(key("a"), { typing: false, dialogOpen: true })).toBeNull();
    // A g pressed while typing does not start a chord.
    resolve(key("g"), { typing: true, dialogOpen: false });
    expect(resolve(key("r"), free)).toBeNull();
  });
});

describe("useShortcuts", () => {
  function Page({ on, act }: { on: boolean; act: (a: ShortcutAction) => void }) {
    useShortcuts(on, act);
    return (
      <>
        <input aria-label="name" />
        <dialog aria-label="sheet" />
      </>
    );
  }

  it("acts on the page, never on keys typed into a field, and not at all when switched off", () => {
    const act = vi.fn();
    const { getByLabelText, rerender } = render(<Page on act={act} />);
    fireEvent.keyDown(document.body, { key: "j" });
    expect(act).toHaveBeenLastCalledWith({ kind: "next" });
    fireEvent.keyDown(getByLabelText("name"), { key: "k" });
    expect(act).toHaveBeenCalledTimes(1);
    rerender(<Page on={false} act={act} />);
    fireEvent.keyDown(document.body, { key: "j" });
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("leaves the keyboard to an open dialog", () => {
    const act = vi.fn();
    const { container } = render(<Page on act={act} />);
    container.querySelector("dialog")?.setAttribute("open", "");
    fireEvent.keyDown(document.body, { key: "j" });
    expect(act).not.toHaveBeenCalled();
  });
});
