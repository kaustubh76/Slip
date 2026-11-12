/**
 * Prints `docs/Slip-overview.html` to `docs/Slip-overview.pdf`.
 *
 * The one-pager was printed by hand from a browser, which is why the PDF spent ten days five
 * decision entries behind the HTML it was printed from (D120). A printed artefact nobody can
 * reprint in one command is one that drifts, and the PDF is the copy that gets attached to things.
 *
 * `preferCSSPageSize` is the whole trick: the document already carries `@page { size: A4; margin:
 * 18mm 16mm 20mm 16mm }`, so Chromium is told to obey it rather than impose its own letter-sized
 * default. `printBackground` keeps the tints that carry meaning in the tables.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const html = join(root, "docs/Slip-overview.html");
const pdf = join(root, "docs/Slip-overview.pdf");

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // `networkidle` rather than `load`: the document inlines everything, but a webfont that has not
  // arrived prints as a fallback and silently changes every line break in the file.
  await page.goto(`file://${html}`, { waitUntil: "networkidle" });
  await page.pdf({ path: pdf, printBackground: true, preferCSSPageSize: true });

  // What the PDF was printed from, so a test can say the two have parted company. Chromium's
  // output is not byte-stable — it stamps a creation date — so hashing the PDF would prove
  // nothing; hashing its source proves exactly the thing that went wrong.
  const stamp = createHash("sha256").update(readFileSync(html)).digest("hex");
  writeFileSync(`${pdf}.sha256`, `${stamp}\n`);
  console.log(`printed ${pdf}`);
} finally {
  await browser.close();
}
