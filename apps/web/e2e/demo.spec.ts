import { expect, test } from "@playwright/test";
import { openDesk } from "./helpers";

test("the console sends the agent shopping with PayPal declining, and logs what PayPal was asked", async ({
  page,
}) => {
  await openDesk(page);
  await page.getByRole("link", { name: "Demo" }).click();
  await expect(page.getByRole("heading", { name: "Send the agent shopping" })).toBeVisible();
  await page.getByLabel("When Slip pays").selectOption("declines");
  await page.getByRole("button", { name: "Retries with the $47.99 trail shoe" }).click();
  const log = page.getByRole("list").filter({ hasText: "Retries with the $47.99 trail shoe:" });
  await expect(log).toContainText("PAID by R7");
  await expect(log).toContainText("PayPal: FAILED");
  // The stand-in PayPal's log: the seed's lamp, then this order, declined.
  const calls = page.getByRole("table");
  await expect(calls.getByRole("row", { name: /CAPTURE \$47\.99.*declined/ })).toBeVisible();
  await log.getByRole("link", { name: "Open the receipt" }).click();
  await expect(page.getByRole("article").first()).toContainText("PayPal declined");
});

test("the console issues a key for the agent script, shown once with the command", async ({
  page,
}) => {
  await openDesk(page);
  await page.goto("/demo");
  await page.getByRole("button", { name: "Issue a key for the script" }).click();
  await expect(page.locator(".slip-key")).toContainText(
    /^SLIP_AGENT_KEY=slip_live_\S+ pnpm demo:agent --errand top-pick --url http:\/\/localhost:3100$/,
  );
  await expect(page.getByRole("button", { name: "Issue a key for the script" })).toHaveCount(0);
});
