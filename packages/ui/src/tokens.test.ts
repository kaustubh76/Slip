import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

/** The `--slip-*` colour declarations of the rule whose selector ends with `selector {`. */
function colours(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) {
    throw new Error(`no rule for ${selector}`);
  }
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  const found: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--slip-([a-z-]+):\s*(#[0-9a-f]{6});/g)) {
    found[name as string] = value as string;
  }
  return found;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = {
  original: colours('[data-slip-theme="original"]'),
  carbon: colours('[data-slip-theme="carbon"]'),
};

/** Text and the background it sits on: WCAG AA for body text. */
const TEXT: [string, string][] = [
  ["ink", "paper"],
  ["ink", "desk"],
  ["ink-faint", "paper"],
  ["ink-faint", "desk"],
  ["pen", "paper"],
  ["pen", "desk"],
  ["paper", "pen"],
  ["stamp-paid", "paper"],
  ["stamp-paid", "desk"],
  ["stamp-paid", "stamp-paid-wash"],
  ["stamp-rejected", "paper"],
  ["stamp-rejected", "desk"],
  ["stamp-rejected", "stamp-rejected-wash"],
  ["stamp-held", "paper"],
  ["stamp-held", "desk"],
  ["stamp-held", "stamp-held-wash"],
  ["stamp-void", "paper"],
  ["stamp-void", "desk"],
];

/** Rules and outlines that carry meaning (dotted leaders, input lines): 3:1. Never text. */
const RULES: [string, string][] = [
  ["ink-ghost", "paper"],
  ["ink-ghost", "desk"],
];

describe("theme tokens", () => {
  it("both themes declare the same colours", () => {
    expect(Object.keys(THEMES.carbon).sort()).toEqual(Object.keys(THEMES.original).sort());
    expect(Object.keys(THEMES.original)).toHaveLength(14);
  });

  it("following the system's dark mode is exactly Carbon", () => {
    expect(colours(":root:not([data-slip-theme])")).toEqual(THEMES.carbon);
  });

  for (const [theme, palette] of Object.entries(THEMES)) {
    it(`${theme}: every text colour reads on its paper (4.5:1)`, () => {
      for (const [fg, bg] of TEXT) {
        const ratio = contrast(palette[fg] ?? "", palette[bg] ?? "");
        expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: rules and outlines are visible (3:1)`, () => {
      for (const [fg, bg] of RULES) {
        const ratio = contrast(palette[fg] ?? "", palette[bg] ?? "");
        expect(ratio, `${fg} on ${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
