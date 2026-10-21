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

  // The stand-in approval page, then back into Slip with a permission in force. This is the first
  // request in the file that touches the database, and the server starts by deleting its PGlite
  // directory so each run begins clean — so this one step pays for the migrations, which takes
  // longer than the 10 s the rest of the file inherits, and longer still while the demo server's
  // tests are running beside it.
  await expect(page.getByRole("button", { name: /Approve/ })).toBeVisible({ timeout: 30_000 });
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

test("the leg PayPal redirects into lands on the permission, not an error page", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.locator("#start-email").fill(someone());
  await page.locator("#start-password").fill(PASSWORD);
  await page.getByRole("button", { name: /Start with PayPal/ }).click();
  await page.getByRole("button", { name: /Approve/ }).click();
  await expect(page).toHaveURL(/\/mandate/);

  // `/mandates/<id>/return` is the address Slip hands PayPal, and PayPal arrives at it as a
  // top-level browser GET. The stand-in cannot: a server action redirecting into a route handler
  // answers 307 with no RSC payload and the owner would see an error page, so the demo finishes
  // the setup in process instead. `page.goto` is that shape, and this is the only place the real
  // redirect leg is exercised — the one the owner's own PayPal approval will take.
  const summary = (await (await page.request.get("/api/v1/mandate")).json()) as { id: string };
  expect(summary.id).toMatch(/^[0-9a-f-]{36}$/);
  await page.goto(`/mandates/${summary.id}/return`);
  await expect(page).toHaveURL(/\/mandate\?setup=/);
  await expect(page.getByRole("main")).toContainText(/in force/i);

  // PayPal can deliver a redirect more than once and an owner can reload it: the request id for
  // the call behind this is derived from the mandate, so every arrival is the same one request.
  await page.goto(`/mandates/${summary.id}/return`);
  await expect(page.getByRole("main")).toContainText(/in force/i);
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
