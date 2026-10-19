import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openDesk } from "./helpers";

// The way in is the one page a visitor meets before anything else, and the only one with no
// session, so it is audited on its own rather than after a desk is opened.
for (const theme of ["original", "carbon"] as const) {
  test(`the way in has no serious accessibility problem (${theme})`, async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addCookies([{ name: "slip-theme", value: theme, url: "http://localhost:3100" }]);
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      `/sign-in (${theme})`,
    ).toEqual([]);
  });
}

for (const theme of ["original", "carbon"] as const) {
  test(`every page has no serious accessibility problem (${theme})`, async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDesk(page);
    await context.addCookies([{ name: "slip-theme", value: theme, url: "http://localhost:3100" }]);
    const first = await page
      .getByRole("region", { name: "Receipts" })
      .getByRole("link")
      .first()
      .getAttribute("href");
    for (const path of [
      "/receipts",
      first ?? "/receipts",
      "/holds",
      "/limits",
      "/agents",
      "/mandate",
      "/bench",
      "/demo",
    ]) {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      const results = await new AxeBuilder({ page }).analyze();
      const serious = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        `${path} (${theme})`,
      ).toEqual([]);
    }
    // The page in more contrast, with the shortcuts sheet open.
    await page.goto("/receipts");
    const contrast = page.getByRole("button", { name: "More contrast" });
    await expect(async () => {
      await contrast.click();
      await expect(page.locator("html")).toHaveAttribute("data-slip-contrast", "more", {
        timeout: 1_000,
      });
    }).toPass();
    await page.getByRole("button", { name: "Keys" }).click();
    await expect(page.getByRole("dialog", { name: "Shortcuts" })).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(
      results.violations
        .filter((v) => v.impact === "serious" || v.impact === "critical")
        .map((v) => v.id),
      `shortcuts sheet, more contrast (${theme})`,
    ).toEqual([]);
  });
}
