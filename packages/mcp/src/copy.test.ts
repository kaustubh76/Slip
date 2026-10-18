import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Words Slip never says to anyone: trading jargon, and anything that reads as a savings claim. */
const BANNED =
  /basis points|\bbps\b|slippage|\bTCA\b|best execution|landed cost|savings|\bsaved\b/i;

describe("copy", () => {
  it("no tool description, instruction or next step says what a receipt must never say", () => {
    const dir = fileURLToPath(new URL("./", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThan(1);
    const offending = files.filter((f) => BANNED.test(readFileSync(join(dir, f), "utf8")));
    expect(offending).toEqual([]);
  });
});
