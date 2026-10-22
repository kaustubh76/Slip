import { expect, type Page } from "@playwright/test";

/** Opens a fresh demo desk: an owner, a permission in force, three agents and their receipts. */
export async function openDesk(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByRole("button", { name: "Open a demo desk →" }).click();
  await page.waitForURL("**/receipts");
  await expect(page.getByRole("region", { name: "Receipts" })).toBeVisible();
}

/** This desk's own id for a demo product, as the catalogue lists it (`<product>--<12 hex digits>`). */
export async function productId(page: Page, base: string): Promise<string> {
  const response = await page.request.get("/api/v1/mandate");
  const mandate = (await response.json()) as { id: string };
  return `${base}--${mandate.id.replaceAll("-", "").slice(0, 12)}`;
}

/** Issues a key for a new agent on the agents page and reads it off the slip, where it shows once. */
export async function issueKey(page: Page, name: string): Promise<string> {
  await page.goto("/agents");
  await page.getByLabel("Name the agent").fill(name);
  await page.getByRole("button", { name: "Issue a key" }).click();
  const key = page.locator(".slip-key");
  await expect(key).toBeVisible();
  return (await key.textContent())?.trim() ?? "";
}
