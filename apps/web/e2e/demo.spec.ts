import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  await expect(page.locator(".slip-command")).toContainText(
    /^claude mcp add --transport http slip http:\/\/localhost:3100\/api\/mcp --header "Authorization:\s+Bearer slip_live_\S+"$/,
  );
  await expect(page.getByRole("button", { name: "Issue a key for the script" })).toHaveCount(0);
  // The MCP server answers to an agent key, never to the owner's cookie.
  expect((await page.request.post("/api/mcp", { data: {} })).status()).toBe(401);
});

test("the agent script, run from a terminal, is checked by Slip and prints on the open roll", async ({
  page,
  baseURL,
}) => {
  await openDesk(page);
  await page.goto("/demo");
  await page.getByRole("button", { name: "Issue a key for the script" }).click();
  const command = (await page.locator(".slip-key").textContent()) ?? "";
  const key = /SLIP_AGENT_KEY=(\S+)/.exec(command)?.[1] ?? "";
  await page.goto("/receipts");
  const roll = page.getByRole("region", { name: "Receipts" });
  await expect(roll.getByRole("img", { name: "Outcome: rejected" })).toHaveCount(1);

  const transcript = await agentScript(["--errand", "top-pick", "--url", baseURL ?? ""], key);
  expect(transcript.code).toBe(0);
  expect(transcript.stdout).toContain('agent   search_products "trail shoe"');
  expect(transcript.stdout).toContain('listing text: "[synthetic] Top pick"');
  expect(transcript.stdout).toContain("REJECTED by R4_OVERPAID");
  expect(transcript.stdout).toContain("next    If you still want this item");
  // Printed on the roll by the live poll, with no reload.
  await expect(roll.getByRole("img", { name: "Outcome: rejected" })).toHaveCount(2, {
    timeout: 10_000,
  });
  await expect(roll).toContainText("agent script");
});

/** Runs `pnpm demo:agent` the way a presenter would, from the repository root. */
function agentScript(
  args: string[],
  key: string,
): Promise<{ code: number | null; stdout: string }> {
  const root = fileURLToPath(new URL("../../..", import.meta.url));
  return new Promise((resolve) => {
    execFile(
      `${root}node_modules/.bin/tsx`,
      ["apps/web/scripts/demo-agent.ts", ...args],
      { cwd: root, env: { ...process.env, SLIP_AGENT_KEY: key } },
      (error, stdout) => resolve({ code: error === null ? 0 : (error.code as number), stdout }),
    );
  });
}
