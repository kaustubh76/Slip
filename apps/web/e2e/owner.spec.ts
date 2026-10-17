import { expect, test } from "@playwright/test";
import { issueKey, openDesk, productId } from "./helpers";

test("a new desk shows the four purchases its agent tried, and says the demo is simulated", async ({
  page,
}) => {
  await openDesk(page);
  await expect(page.getByText(/^Simulated demo: PayPal and Channel3 are stand-ins/)).toBeVisible();
  const roll = page.getByRole("region", { name: "Receipts" });
  await expect(roll.getByRole("img", { name: "Outcome: paid" })).toHaveCount(1);
  await expect(roll.getByRole("img", { name: "Outcome: rejected" })).toHaveCount(1);
  await expect(roll.getByRole("img", { name: "Outcome: held" })).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Waiting for you" })).toBeVisible();
});

test("the rejected receipt reads in five seconds, with every offer behind it", async ({ page }) => {
  await openDesk(page);
  await page.getByRole("link", { name: "Your agent tried to pay $58.99 at Store A." }).click();
  const slip = page.getByRole("article").first();
  await expect(slip).toContainText("The same item was listed at $47.99 at Store B.");
  await expect(slip).toContainText("Overpaid by $11.00 (23%).");
  await expect(slip).toContainText("Store A pays your agent's platform up to 8% commission");
  await expect(slip).toContainText("Payment rejected. Nothing was charged.");
  await expect(slip).toContainText("Listed item prices from a simulated Channel3");
  // A made-up store has no page to open.
  await expect(page.getByRole("link", { name: /Open the/ })).toHaveCount(0);
  const offers = page.getByRole("table");
  await expect(offers.getByRole("row", { name: /Store B.*LOWEST/ })).toBeVisible();
  await expect(offers.getByRole("row", { name: /Store A.*CHOSEN/ })).toBeVisible();
});

test("approving names the exact amount, and a double click captures once", async ({ page }) => {
  await openDesk(page);
  await page.goto("/holds");
  const hold = page.getByRole("article").filter({ hasText: "$239.00" });
  await hold.getByRole("button", { name: "Approve…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Take $239.00 from your PayPal for Store K?");
  await dialog.getByRole("button", { name: /Approve and take \$239\.00/ }).dblclick();
  // The slip moves to the decided list, paid.
  await expect(page.getByRole("region", { name: "Decided" })).toContainText("$239.00", {
    timeout: 15_000,
  });
  const receipts = (await (await page.request.get("/api/v1/holds")).json()) as {
    decided: { view: { receiptId: string; state: { word: string } } }[];
  };
  const approved = receipts.decided.find((r) => r.view.state.word === "CAPTURED");
  expect(approved).toBeDefined();
  const detail = (await (
    await page.request.get(`/api/v1/receipts/${approved?.view.receiptId}`)
  ).json()) as { timeline: { from: string; to: string }[] };
  expect(detail.timeline.filter((t) => t.to === "CAPTURING")).toHaveLength(1);
});

test("declining releases the hold, and nothing is charged", async ({ page }) => {
  await openDesk(page);
  await page.goto("/holds");
  // Held while Channel3 was down: no listed price, and nothing reserved at PayPal.
  const hold = page.getByRole("article").filter({ hasText: "Store D" });
  await hold.getByRole("button", { name: "Decline…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Decline" }).click();
  await expect(page.getByRole("region", { name: "Decided" })).toContainText("You declined at");
});

test("a purchase the agent makes prints on the roll without a reload", async ({ page }) => {
  await openDesk(page);
  const key = await issueKey(page, "scout");
  const product = await productId(page, "trail-shoe");
  await page.goto("/receipts");
  const roll = page.getByRole("region", { name: "Receipts" });
  await expect(roll.getByRole("listitem")).toHaveCount(4);
  const answer = await page.request.post("/api/v1/agent/checkout", {
    headers: { authorization: `Bearer ${key}` },
    data: {
      productId: product,
      chosenOfferUrl: "https://store-b.example/p/trail-shoe",
      reason: "lowest listed price",
    },
  });
  expect(answer.status()).toBe(200);
  expect(await answer.json()).toMatchObject({ status: "decided", outcome: "PAID" });
  await expect(roll.getByRole("listitem")).toHaveCount(5, { timeout: 15_000 });
  await expect(roll.getByRole("listitem").first()).toContainText("$47.99");
});

test("nothing is readable without a session", async ({ request }) => {
  for (const path of ["/api/v1/receipts", "/api/v1/holds", "/api/v1/stamp", "/api/v1/mandate"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
  }
});

test("the bench says neither study has run, and prints no figures", async ({ page }) => {
  await openDesk(page);
  await page.getByRole("link", { name: "Bench" }).click();
  await expect(page.getByRole("img", { name: "This study has not run yet" })).toBeVisible();
  await expect(page.getByRole("img", { name: "This benchmark has not run yet" })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("150–200 products");
  // No measured-looking number until a study has produced one.
  expect(await page.getByRole("main").textContent()).not.toMatch(/\d%/);
});
