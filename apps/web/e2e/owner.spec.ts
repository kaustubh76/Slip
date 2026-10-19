import { expect, test } from "@playwright/test";
import { issueKey, openDesk, productId } from "./helpers";

test("a new desk shows the four purchases its agent tried, and says the demo is simulated", async ({
  page,
}) => {
  await openDesk(page);
  await expect(
    page.getByText(
      /^Stores and prices are stand-ins made up in this server\. PayPal is a stand-in running in this server; no real money moves\./,
    ),
  ).toBeVisible();
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

test("the bench prints the market study as measured, and says the benchmark has not run", async ({
  page,
}) => {
  await openDesk(page);
  await page.getByRole("link", { name: "Bench" }).click();
  const main = page.getByRole("main");

  // The study has run, so the page shows its figures with the sample size and the date on them.
  await expect(main).toContainText("240 products from 8 searches");
  await expect(main).toContainText("2026-10-19");
  await expect(main).toContainText("18.33%");
  // Including the part that does not flatter us.
  await expect(main).toContainText("minority of products");

  // The benchmark has not, and says so rather than showing an empty table.
  await expect(page.getByRole("img", { name: "This benchmark has not run yet" })).toBeVisible();
  await expect(main).toContainText("waiting on a model key");
});

test("another desk's receipt reads as not found, the same as no receipt at all", async ({
  page,
  browser,
}) => {
  await openDesk(page);
  const mine = (await (await page.request.get("/api/v1/receipts")).json()) as {
    rows: { view: { receiptId: string } }[];
  };
  const id = mine.rows[0]?.view.receiptId ?? "";
  expect(id).not.toBe("");
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await openDesk(stranger);
  for (const path of [`/receipts/${id}`, "/receipts/0190a1b2-0000-7000-8000-000000000000"]) {
    const response = await stranger.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(stranger.getByText("Nothing is printed at this address.")).toBeVisible();
  }
  expect((await stranger.request.get(`/api/v1/receipts/${id}`)).status()).toBe(404);
  await other.close();
});
