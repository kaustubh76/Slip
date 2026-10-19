import { expect, test } from "@playwright/test";

/**
 * The shape a real owner meets: no demo, no desks, and the credential they set is the only way
 * back in (D71). This is the deployment that had no browser coverage at all, which is how it went
 * unnoticed that there was no way back in.
 *
 * It runs on its own server (see `playwright.config.ts`), with a stand-in PayPal because no keys
 * are set — so "approve" happens on Slip's own stand-in page rather than at PayPal.
 */

/** A fresh address per test: the server keeps one database across the file. */
const someone = () => `owner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
const PASSWORD = "a reasonable passphrase";

test.describe.configure({ mode: "serial" });

test("starting needs no credential, but offers one", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: /Start with PayPal/ })).toBeVisible();
  // Optional while the payment is a stand-in, and the page says why it is worth setting.
  await expect(page.getByRole("main")).toContainText("only way back in");
  // Optional here: the stand-in payment moves no money, so an owner may skip it.
  expect(await page.locator("#start-email").getAttribute("required")).toBeNull();
});

test("an owner who sets a credential can sign out and come back", async ({ page }) => {
  const email = someone();
  await page.goto("/sign-in");
  await page.locator("#start-email").fill(email);
  await page.locator("#start-password").fill(PASSWORD);
  await page.getByRole("button", { name: /Start with PayPal/ }).click();

  // The stand-in approval page, then back into Slip with a permission in force.
  await expect(page.getByRole("button", { name: /Approve/ })).toBeVisible();
  await page.getByRole("button", { name: /Approve/ }).click();
  // Approving finishes the setup and lands on the permission slip, in force.
  await expect(page).toHaveURL(/\/mandate/);
  await expect(page.getByRole("main")).toContainText(/in force|active/i);

  // Losing the session is what the credential is for.
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.locator("#return-email").fill(email);
  await page.locator("#return-password").fill(PASSWORD);
  await page.getByRole("button", { name: /^Sign in/ }).click();
  await expect(page).toHaveURL(/\/receipts|\/mandate/);
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
});

test("a wrong password says the same thing as an unknown owner", async ({ page }) => {
  const email = someone();
  await page.goto("/sign-in");
  await page.locator("#return-email").fill(email);
  await page.locator("#return-password").fill("not the passphrase");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  const unknown = await page.getByRole("status").textContent();
  expect(unknown).toContain("do not match an owner");

  // The same message for an address that does exist with a different password: this form must not
  // be a way to find out which addresses have Slip accounts.
  await page.goto("/sign-in");
  await page.locator("#start-email").fill(email);
  await page.locator("#start-password").fill(PASSWORD);
  await page.getByRole("button", { name: /Start with PayPal/ }).click();
  await expect(page.getByRole("button", { name: /Approve/ })).toBeVisible();
  await page.getByRole("button", { name: /Sign out/ }).click();
  await page.locator("#return-email").fill(email);
  await page.locator("#return-password").fill("still not it");
  await page.getByRole("button", { name: /^Sign in/ }).click();
  expect(await page.getByRole("status").textContent()).toBe(unknown);
});

test("there are no demo desks here", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: /Open a demo desk/ })).toHaveCount(0);
});
