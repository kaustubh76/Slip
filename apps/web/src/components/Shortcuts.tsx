"use client";

import { SHORTCUTS, type ShortcutAction, useShortcuts } from "@slip/ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { THEME_SWITCH_EVENT } from "./ThemeToggle";

/** Where this browser remembers that the owner turned the shortcuts off. */
const OFF_KEY = "slip-shortcuts-off";

function storedOff(): boolean {
  try {
    return window.localStorage.getItem(OFF_KEY) === "1";
  } catch {
    return false;
  }
}

function storeOff(off: boolean): void {
  try {
    if (off) {
      window.localStorage.setItem(OFF_KEY, "1");
    } else {
      window.localStorage.removeItem(OFF_KEY);
    }
  } catch {
    // Storage blocked: the switch still holds for this page.
  }
}

function Keys({ keys }: { keys: readonly string[] }) {
  return keys.map((key, i) => (
    <span key={key}>
      {i > 0 ? " " : null}
      <kbd>{key}</kbd>
    </span>
  ));
}

/** Each receipt or hold on the page: roll rows and slips alike carry their outcome. */
function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("main [data-slip-outcome]")];
}

function firstControl(item: HTMLElement): HTMLElement | null {
  return item.querySelector<HTMLElement>("a[href], button:not([disabled])");
}

/** j and k: focus the next or previous receipt or hold, wrapping at the ends. */
function step(by: 1 | -1): void {
  const all = items().filter((item) => firstControl(item) !== null);
  if (all.length === 0) {
    return;
  }
  const at = all.findIndex((item) => item.contains(document.activeElement));
  const next = at === -1 ? (by === 1 ? 0 : all.length - 1) : (at + by + all.length) % all.length;
  const target = all[next];
  const control = target === undefined ? null : firstControl(target);
  control?.focus();
  control?.scrollIntoView({ block: "nearest" });
}

/** a and d: open the dialog for the hold in focus, or the first on the page. Never confirms. */
function open(action: "approve" | "decline"): void {
  const selector = `[data-slip-action="${action}"]:not([disabled])`;
  const focused = document.activeElement?.closest<HTMLElement>("[data-slip-outcome]");
  const button =
    focused?.querySelector<HTMLElement>(selector) ??
    document.querySelector<HTMLElement>(`main ${selector}`);
  button?.click();
}

/**
 * The keyboard shortcuts, their help sheet and its on/off switch (WCAG 2.1.4: single-key
 * shortcuts can be turned off). The switch is remembered in this browser only.
 */
export function Shortcuts() {
  const router = useRouter();
  const [on, setOn] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    setOn(!storedOff());
  }, []);

  useEffect(() => {
    const node = sheet.current;
    if (node === null) {
      return;
    }
    if (sheetOpen && !node.open) {
      node.showModal();
    } else if (!sheetOpen && node.open) {
      node.close();
    }
  }, [sheetOpen]);

  useShortcuts(on, (action: ShortcutAction) => {
    switch (action.kind) {
      case "go":
        router.push(`/${action.to}`);
        return;
      case "next":
        step(1);
        return;
      case "previous":
        step(-1);
        return;
      case "approve":
      case "decline":
        open(action.kind);
        return;
      case "filter":
        document.querySelector<HTMLElement>("main select")?.focus();
        return;
      case "theme":
        document.dispatchEvent(new Event(THEME_SWITCH_EVENT));
        return;
      case "help":
        setSheetOpen(true);
        return;
    }
  });

  return (
    <>
      <button
        type="button"
        className="slip-link slip-meta"
        aria-haspopup="dialog"
        onClick={() => setSheetOpen(true)}
      >
        Keys
      </button>
      <dialog
        ref={sheet}
        className="slip-dialog"
        aria-labelledby={titleId}
        onClose={() => setSheetOpen(false)}
      >
        <p className="slip-meta">Keyboard</p>
        <h2 id={titleId} className="slip-title">
          Shortcuts
        </h2>
        <table className="slip-keys">
          <tbody>
            {SHORTCUTS.map((shortcut) => (
              <tr key={shortcut.does}>
                <th scope="row">
                  <Keys keys={shortcut.keys} />
                  {shortcut.followedBy === undefined ? null : (
                    <>
                      {" then "}
                      <Keys keys={shortcut.followedBy} />
                    </>
                  )}
                </th>
                <td>{shortcut.does}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="slip-check">
          <input
            type="checkbox"
            checked={on}
            onChange={(event) => {
              setOn(event.target.checked);
              storeOff(!event.target.checked);
            }}
          />{" "}
          Use these shortcuts
        </label>
        <div className="slip-dialog-actions">
          <button type="button" className="slip-button" onClick={() => setSheetOpen(false)}>
            Close
          </button>
        </div>
      </dialog>
    </>
  );
}
