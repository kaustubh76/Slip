import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openDesk } from "./helpers";

/**
 * The origin the suite is actually running against. A cookie set for a hardcoded port is simply
 * ignored when the ports are overridden, and the override exists because an unrelated server can
 * hold 3100 — as one did on 30 Oct 2026, when this and `demo.spec.ts` were the only two specs that
 * could not follow it.
 */
const origin = (baseURL: string | undefined): string => baseURL ?? "http://localhost:3100";

// The way in is the one page a visitor meets before anything else, and the only one with no
// session, so it is audited on its own rather than after a desk is opened.
for (const theme of ["original", "carbon"] as const) {
  test(`the way in has no serious accessibility problem (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await context.addCookies([{ name: "slip-theme", value: theme, url: origin(baseURL) }]);
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
  test(`every page has no serious accessibility problem (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDesk(page);
    await context.addCookies([{ name: "slip-theme", value: theme, url: origin(baseURL) }]);
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

  test(`the states a path list never reaches are clean too (${theme})`, async ({
    page,
    context,
    baseURL,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openDesk(page);
    await context.addCookies([{ name: "slip-theme", value: theme, url: origin(baseURL) }]);
    const serious = async (where: string) => {
      const results = await new AxeBuilder({ page }).analyze();
      expect(
        results.violations
          .filter((v) => v.impact === "serious" || v.impact === "critical")
          .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        `${where} (${theme})`,
      ).toEqual([]);
    };

    // Older receipts: the one layout with neither a rail nor a list, and the only place the
    // Receipts region renders without them. Any well-formed cursor reaches it (D78).
    const cursor = Buffer.from(
      `${new Date(Date.now() + 86_400_000).toISOString()}|00000000-0000-4000-8000-000000000000`,
      "utf8",
    ).toString("base64url");
    await page.goto(`/receipts?before=${cursor}`);
    await expect(page.getByRole("region", { name: "Receipts" })).toBeVisible();
    await serious("the older-receipts page");

    // A hold's dialog carries a role="status" refusal, a confirm that can be disabled and an
    // aria-busy; the only dialog ever audited was the shortcuts sheet.
    await page.goto("/holds");
    await page.getByRole("button", { name: "Approve…" }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await serious("a hold's approve dialog");
  });
}
