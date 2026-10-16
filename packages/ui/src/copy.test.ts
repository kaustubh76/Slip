// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Words the owner UI never uses: trading jargon, and anything that reads as a savings claim. */
const BANNED =
  /basis points|\bbps\b|slippage|\bTCA\b|best execution|landed cost|savings|\bsaved\b/i;

const root = fileURLToPath(new URL("./", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__fixtures__" ? [] : sources(path);
    }
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("copy", () => {
  it("no UI source says what the receipt must never say", () => {
    const files = sources(root);
    expect(files.length).toBeGreaterThan(3);
    const offending = files.filter((file) => BANNED.test(readFileSync(file, "utf8")));
    expect(offending).toEqual([]);
  });
});
