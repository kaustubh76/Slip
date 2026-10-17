"use client";

import { SLIP_THEMES, type SlipTheme, THEME_ATTRIBUTE, themeCookie } from "@slip/ui";
import { useEffect, useRef, useState } from "react";

/** Dispatched on `document` by the `t` shortcut: switch to the other theme. */
export const THEME_SWITCH_EVENT = "slip:switch-theme";

/** The theme on show: the stored choice, or the system's when there is none. */
function shown(theme: SlipTheme | null): SlipTheme {
  if (theme !== null) {
    return theme;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "carbon" : "original";
}

/** Original | Carbon. Applies at once and is remembered in a cookie the server reads. */
export function ThemeToggle({ initial }: { initial: SlipTheme | null }) {
  const [theme, setTheme] = useState<SlipTheme | null>(initial);
  const choose = (next: SlipTheme) => {
    document.documentElement.setAttribute(THEME_ATTRIBUTE, next);
    // biome-ignore lint/suspicious/noDocumentCookie: the server must read the choice on the next render
    document.cookie = themeCookie(next);
    setTheme(next);
  };
  const current = useRef(theme);
  current.current = theme;
  useEffect(() => {
    const flip = () => choose(shown(current.current) === "carbon" ? "original" : "carbon");
    document.addEventListener(THEME_SWITCH_EVENT, flip);
    return () => document.removeEventListener(THEME_SWITCH_EVENT, flip);
  }, []);
  return (
    <fieldset className="slip-theme">
      <legend className="slip-sr">Theme</legend>
      {SLIP_THEMES.map((option, i) => (
        <span key={option}>
          {i > 0 ? <span aria-hidden="true"> | </span> : null}
          <button
            type="button"
            className="slip-link slip-theme-option"
            aria-pressed={theme === option}
            onClick={() => choose(option)}
          >
            {option === "original" ? "Original" : "Carbon"}
          </button>
        </span>
      ))}
    </fieldset>
  );
}
