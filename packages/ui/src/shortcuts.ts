"use client";

import { useEffect, useRef } from "react";

/**
 * Keyboard shortcuts for the owner's pages. Single keys, so they must be possible to turn off
 * (WCAG 2.1.4): the host keeps the on/off switch and passes it in. They never act on money by
 * themselves — `a` and `d` only open the approve or decline dialog, whose confirm still needs a
 * deliberate press — and they stay out of the way while the owner types or a dialog is open.
 */

export type ShortcutPage = "receipts" | "holds" | "limits" | "agents" | "bench" | "mandate";

export type ShortcutAction =
  | { kind: "go"; to: ShortcutPage }
  | { kind: "next" }
  | { kind: "previous" }
  | { kind: "approve" }
  | { kind: "decline" }
  | { kind: "filter" }
  | { kind: "theme" }
  | { kind: "help" };

export interface ShortcutHelp {
  /** Keys that each do it, e.g. j and k. */
  keys: readonly string[];
  /** For a chord: the keys that may follow the first, e.g. g then r, h, l… */
  followedBy?: readonly string[];
  does: string;
}

/** What the help sheet lists, in its order. */
export const SHORTCUTS: readonly ShortcutHelp[] = [
  { keys: ["j", "k"], does: "next or previous receipt or hold" },
  { keys: ["Enter"], does: "open it" },
  {
    keys: ["a", "d"],
    does: "approve or decline the hold in focus (opens the dialog; nothing is sent)",
  },
  { keys: ["/"], does: "filter the roll by agent" },
  {
    keys: ["g"],
    followedBy: ["r", "h", "l", "a", "b", "m"],
    does: "go to Receipts, Holds, Limits, Agents, Bench or Mandate",
  },
  { keys: ["t"], does: "switch between Original and Carbon" },
  { keys: ["?"], does: "this sheet" },
  { keys: ["Esc"], does: "close a dialog" },
];

const GO: Readonly<Record<string, ShortcutPage>> = {
  r: "receipts",
  h: "holds",
  l: "limits",
  a: "agents",
  b: "bench",
  m: "mandate",
};

const SINGLE: Readonly<Record<string, ShortcutAction>> = {
  j: { kind: "next" },
  k: { kind: "previous" },
  a: { kind: "approve" },
  d: { kind: "decline" },
  "/": { kind: "filter" },
  t: { kind: "theme" },
  "?": { kind: "help" },
};

/** How long after `g` the second key of a "go to" counts. */
export const CHORD_MS = 1_000;

export interface ShortcutKey {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface ShortcutContext {
  /** The owner is typing in a field: every key is theirs. */
  typing: boolean;
  /** A dialog is open: it has the keyboard (Esc is the browser's). */
  dialogOpen: boolean;
}

/** Turns key presses into actions, remembering a pending `g` between presses. */
export function createShortcutResolver(now: () => number = Date.now) {
  let chordAt: number | null = null;
  return (event: ShortcutKey, context: ShortcutContext): ShortcutAction | null => {
    if (event.ctrlKey || event.metaKey || event.altKey || context.typing || context.dialogOpen) {
      chordAt = null;
      return null;
    }
    const at = now();
    if (chordAt !== null && at - chordAt <= CHORD_MS) {
      chordAt = null;
      const to = GO[event.key];
      return to === undefined ? null : { kind: "go", to };
    }
    chordAt = null;
    if (event.key === "g") {
      chordAt = at;
      return null;
    }
    return SINGLE[event.key] ?? null;
  };
}

/** True when keys typed here belong to a field, not to the page. */
export function isTyping(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Listens for the shortcuts while `enabled`; `onAction` may change between renders. */
export function useShortcuts(enabled: boolean, onAction: (action: ShortcutAction) => void): void {
  const act = useRef(onAction);
  act.current = onAction;
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const resolve = createShortcutResolver();
    const onKey = (event: KeyboardEvent) => {
      const action = resolve(event, {
        typing: isTyping(event.target),
        dialogOpen: document.querySelector("dialog[open]") !== null,
      });
      if (action !== null) {
        event.preventDefault();
        act.current(action);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled]);
}
