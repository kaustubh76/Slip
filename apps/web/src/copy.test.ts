import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The web app's pages say what the kit's copy test bans there (trading jargon, anything that
 * reads as a savings claim). One difference: "saved payment method" is PayPal's own name for the
 * vaulted method the owner approves, so "saved" alone is allowed here; a claim that the owner
 * saved money is not.
 */
const BANNED =
  /basis points|\bbps\b|slippage|\bTCA\b|best execution|landed cost|savings|you saved|saved you\b|\bsaved \$/i;

const root = fileURLToPath(new URL("../", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__fixtures__" || name === "node_modules" ? [] : sources(path);
    }
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("copy", () => {
  it("no page, view, component or script says what a receipt must never say", () => {
    const files = [...sources(join(root, "src")), ...sources(join(root, "scripts"))];
    expect(files.length).toBeGreaterThan(20);
    const offending = files.filter((file) => BANNED.test(readFileSync(file, "utf8")));
    expect(offending).toEqual([]);
  });
});
