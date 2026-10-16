import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The anti-generic guardrails, enforced: outside tokens.css no stylesheet may write a colour, a
 * font or a radius of its own, blur a shadow, or paint a gradient — except the one perforation,
 * fenced by `perforation:start` / `perforation:end`.
 */

const dir = new URL("./", import.meta.url);
const sheets = readdirSync(dir)
  .filter((f) => f.endsWith(".css") && f !== "tokens.css")
  .map((f) => ({ file: f, css: readFileSync(new URL(f, dir), "utf8") }));

/** Every `property: value` in a stylesheet, without comments or the fenced perforation. */
function declarations(css: string): { property: string; value: string }[] {
  const unfenced = css
    .replace(/\/\* perforation:start[\s\S]*?perforation:end \*\//g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  return [...unfenced.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].map((m) => ({
    property: (m[1] as string).trim(),
    value: (m[2] as string).trim(),
  }));
}

const COLOUR_LITERAL =
  /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(black|white|red|green|blue|gray|grey|silver|navy|orange|yellow|purple)\b/i;

describe("design lint", () => {
  it("finds the stylesheets", () => {
    expect(sheets.map((s) => s.file)).toContain("components.css");
  });

  for (const { file, css } of sheets) {
    const all = declarations(css);

    it(`${file}: colours come only from the tokens`, () => {
      const bad = all.filter((d) => !d.property.startsWith("--") && COLOUR_LITERAL.test(d.value));
      expect(bad).toEqual([]);
    });

    it(`${file}: no gradients, blurs or filters`, () => {
      const bad = all.filter(
        (d) =>
          /gradient\(/.test(d.value) || /blur\(/.test(d.value) || d.property === "backdrop-filter",
      );
      expect(bad).toEqual([]);
    });

    it(`${file}: shadows are lines, never blurred`, () => {
      const bad = all.filter((d) => {
        if (d.property !== "box-shadow" && d.property !== "text-shadow") {
          return false;
        }
        return d.value.split(",").some((shadow) => {
          const lengths = shadow.match(/-?\d*\.?\d+(px|rem|em)?/g) ?? [];
          return lengths.length >= 3 && Number.parseFloat(lengths[2] ?? "0") !== 0;
        });
      });
      expect(bad).toEqual([]);
    });

    it(`${file}: radii are square, 2px or 4px at most`, () => {
      const bad = all.filter((d) => {
        if (!d.property.includes("radius")) {
          return false;
        }
        return d.value
          .split(/\s+/)
          .some(
            (part) =>
              !part.startsWith("var(--slip-radius-") &&
              part !== "0" &&
              !(part.endsWith("px") && Number.parseFloat(part) <= 4),
          );
      });
      expect(bad).toEqual([]);
    });

    it(`${file}: only the two Plex faces, through the tokens`, () => {
      const bad = all.filter(
        (d) =>
          d.property === "font-family" &&
          !/^var\(--slip-font-(sans|mono)\)$/.test(d.value) &&
          d.value !== "inherit",
      );
      expect(bad).toEqual([]);
    });
  }

  it("the perforation is the only fenced exception, and it is fenced once", () => {
    const fences = sheets.flatMap((s) => [...s.css.matchAll(/perforation:start/g)]);
    expect(fences).toHaveLength(1);
  });
});
