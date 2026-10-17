import { expect, test } from "@playwright/test";
import { openDesk } from "./helpers";

test("the keyboard gets around and opens a hold's dialog without sending it, until switched off", async ({
  page,
}) => {
  await openDesk(page);
  // Keys do nothing until the page has hydrated: retry the first until it lands.
  await expect(async () => {
    await page.keyboard.press("g");
    await page.keyboard.press("h");
    await page.waitForURL("**/holds", { timeout: 1_000 });
  }).toPass();
  await page.keyboard.press("j");
  await expect(page.locator("main [data-slip-outcome]").first().locator(":focus")).toHaveCount(1);
  await page.keyboard.press("d");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Decline");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Opening a dialog by key decided nothing.
  const holds = (await (await page.request.get("/api/v1/holds")).json()) as { pending: unknown[] };
  expect(holds.pending).toHaveLength(2);

  await page.keyboard.press("?");
  const sheet = page.getByRole("dialog", { name: "Shortcuts" });
  await expect(sheet).toContainText("go to Receipts, Holds, Limits, Agents, Bench or Mandate");
  await sheet.getByLabel("Use these shortcuts").uncheck();
  await sheet.getByRole("button", { name: "Close" }).click();
  await page.keyboard.press("g");
  await page.keyboard.press("r");
  await page.waitForTimeout(1_000);
  expect(new URL(page.url()).pathname).toBe("/holds");
  // Remembered across a reload.
  await page.reload();
  const again = page.getByRole("dialog", { name: "Shortcuts" });
  await expect(async () => {
    await page.getByRole("button", { name: "Keys" }).click();
    await expect(again).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(again.getByLabel("Use these shortcuts")).not.toBeChecked();
});

test("t switches the theme, and More contrast is remembered across a reload", async ({ page }) => {
  await openDesk(page);
  const html = page.locator("html");
  await expect(async () => {
    await page.keyboard.press("t");
    await expect(html).toHaveAttribute("data-slip-theme", "carbon", { timeout: 1_000 });
  }).toPass();
  await expect(page.getByRole("button", { name: "Carbon" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "More contrast" }).click();
  await expect(html).toHaveAttribute("data-slip-contrast", "more");
  await page.reload();
  await expect(html).toHaveAttribute("data-slip-contrast", "more");
  await expect(html).toHaveAttribute("data-slip-theme", "carbon");
  await expect(page.getByRole("button", { name: "More contrast" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
