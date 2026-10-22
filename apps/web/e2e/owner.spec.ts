import { expect, test } from "@playwright/test";
import { issueKey, openDesk, productId } from "./helpers";

test("a new desk opens on the four purchases of its morning, and says the demo is simulated", async ({
  page,
}) => {
  await openDesk(page);
  await expect(
    page.getByText(
      /^Stores and prices are stand-ins made up in this server\. PayPal is a stand-in running in this server; no real money moves\./,
    ),
  ).toBeVisible();
  const roll = page.getByRole("region", { name: "Receipts" });
  // The newest four, under today's date: one of each kind, whatever history is filed below them.
  const top = await Promise.all(
    [0, 1, 2, 3].map(async (i) =>
      roll.getByRole("listitem").nth(i).getByRole("img").first().getAttribute("aria-label"),
    ),
  );
  expect(top.sort()).toEqual([
    "Outcome: held",
    "Outcome: held",
    "Outcome: paid",
    "Outcome: rejected",
  ]);
  // And the history under them: more than one page of receipts, over more than one day.
  await expect(roll.getByRole("listitem")).toHaveCount(25);
  await expect(roll.getByRole("button", { name: /Older receipts/ })).toBeVisible();
  await expect(roll.locator(".slip-day")).not.toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Waiting for you" })).toBeVisible();
});

test("the rejected receipt reads in five seconds, with every offer behind it", async ({ page }) => {
  await openDesk(page);
  await page
    .getByRole("link", { name: "Your agent tried to pay $58.99 at Store A." })
    .first()
    .click();
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

test("the ids behind a receipt are whole and can be taken, and the back of it folds", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-write"]);
  await openDesk(page);
  await page
    .getByRole("link", { name: "Your agent tried to pay $58.99 at Store A." })
    .first()
    .click();
  const fold = page.locator("details.slip-fold");
  // It opens open: Slip's working is not something the reader has to ask for.
  await expect(fold).toHaveAttribute("open", "");
  // The receipt's own id, in full rather than the header's abbreviation.
  const id = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(id).not.toBe("");
  await expect(fold).toContainText(id);
  await page.getByRole("button", { name: "Copy the receipt id" }).click();
  await expect(fold.getByText("copied")).toBeVisible();
  // Folded, what it covers goes with it; unfolded, it is back.
  await fold.locator("summary").click();
  await expect(page.getByRole("table")).toBeHidden();
  await fold.locator("summary").click();
  await expect(page.getByRole("table")).toBeVisible();
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
  const top = roll.getByRole("listitem").first();
  await expect(top).not.toContainText("$47.99");
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
  // Printed at the top of the roll by the live poll, with no reload. Counting rows would prove
  // nothing now: a full page does not grow, the newest arrival pushes the oldest off the end.
  await expect(top).toContainText("$47.99", { timeout: 15_000 });
  await expect(top).toContainText("scout");
});

test("nothing is readable without a session", async ({ request }) => {
  for (const path of ["/api/v1/receipts", "/api/v1/holds", "/api/v1/stamp", "/api/v1/mandate"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(401);
  }
});

test("the bench prints the market study and the benchmark as measured", async ({ page }) => {
  await openDesk(page);
  await page.getByRole("link", { name: "Bench" }).click();
  const main = page.getByRole("main");

  // The study has run, so the page shows its figures with the sample size and the date on them.
  await expect(main).toContainText("240 products from 8 searches");
  await expect(main).toContainText("2026-10-19");
  await expect(main).toContainText("18.33%");
  // Including the part that does not flatter us.
  await expect(main).toContainText("minority of products");

  // The benchmark has run too: the stamp carries its date and the table carries its rows, rather
  // than the page promising numbers it does not have.
  await expect(page.getByRole("img", { name: /^Run on \d{4}-\d{2}-\d{2}$/ })).toBeVisible();
  await expect(main).toContainText("Per agent and condition");
  await expect(main).toContainText("claude-haiku-5-5");
  // What has results, never what is merely wired.
  await expect(main).toContainText("measured of 2 wired");
  await expect(main).not.toContainText("waiting on a model key");
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
