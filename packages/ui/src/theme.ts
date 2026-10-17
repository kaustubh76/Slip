/**
 * Two themes on one paper: Original (light, the default for the video) and Carbon (dark, the same
 * impression pressed through carbon paper). The server renders `data-slip-theme` from the stored
 * cookie, so the first paint is already right; with no stored choice the stylesheet follows the
 * system preference, so nothing has to run before paint.
 */

export const SLIP_THEMES = ["original", "carbon"] as const;
export type SlipTheme = (typeof SLIP_THEMES)[number];

/** The cookie that remembers the owner's choice. */
export const THEME_COOKIE = "slip-theme";

/** The attribute on `<html>` the stylesheet reads. */
export const THEME_ATTRIBUTE = "data-slip-theme";

/** A stored choice, or null for "follow the system". */
export function parseTheme(value: string | null | undefined): SlipTheme | null {
  return value === "original" || value === "carbon" ? value : null;
}

/** The cookie and attribute for "more contrast": faint ink becomes full ink, in either theme. */
export const CONTRAST_COOKIE = "slip-contrast";
export const CONTRAST_ATTRIBUTE = "data-slip-contrast";

/** True when the stored choice is "more". */
export function parseContrast(value: string | null | undefined): boolean {
  return value === "more";
}

/** The cookie that saves the contrast choice for a year; "normal" clears the preference. */
export function contrastCookie(more: boolean): string {
  return `${CONTRAST_COOKIE}=${more ? "more" : "normal"}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

/** The cookie that saves `theme` for a year, on every path. */
export function themeCookie(theme: SlipTheme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
