import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openDesk } from "./helpers";

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
  });
}
