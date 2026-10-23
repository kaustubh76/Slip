import { expect, type Page, test } from "@playwright/test";
import { issueKey, openDesk, productId } from "./helpers";

/** The stand-in PayPal's calls for this desk, as the console lists them. */
async function paypalCalls(page: Page): Promise<string[]> {
  await page.goto("/demo");
  return page.getByRole("table").getByRole("row").allTextContents();
}

test("an order-less hold whose price moved is not paid until the owner confirms the new amount", async ({
  page,
}) => {
  // Slip reuses its copy of a listing for a minute (the demo's freshness limit), so the price
  // change is seen only once that copy is older: this test waits it out.
  test.slow();
  await openDesk(page);
  await page.goto("/holds");
  const hold = page.getByRole("article").filter({ hasText: "Store D" });
  await hold.getByRole("button", { name: "Approve…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Pay $310.00 at Store D?");

  const store = await page.context().newPage();
  await store.goto("/demo");
  await store.getByRole("button", { name: "Raise the standing desk's price by $8" }).click();
  await expect(store.getByText(/now listed at \$318\.00/)).toBeVisible();

  await page.waitForTimeout(62_000);
  await dialog.getByRole("button", { name: "Approve and pay $310.00" }).click();
  await expect(dialog).toContainText("The price changed: $310.00 → $318.00");
  await expect(dialog).toContainText("Nothing has been charged.");
  expect((await paypalCalls(store)).some((row) => row.includes("$318.00"))).toBe(false);

  await dialog.getByRole("button", { name: "Approve and pay $318.00" }).click();
  await expect(page.getByRole("region", { name: "Decided" })).toContainText("You approved", {
    timeout: 15_000,
  });
  await expect
    .poll(async () => (await paypalCalls(store)).filter((row) => row.includes("CAPTURE $318.00")))
    .toHaveLength(1);
});

test("two tabs approving one hold capture once, and a third tab says it was already approved", async ({
  page,
}) => {
  await openDesk(page);
  const second = await page.context().newPage();
  const third = await page.context().newPage();
  for (const tab of [page, second, third]) {
    await tab.goto("/holds");
    await tab
      .getByRole("article")
      .filter({ hasText: "$239.00" })
      .getByRole("button", { name: "Approve…" })
      .click();
    await expect(tab.getByRole("dialog")).toContainText("Take $239.00 from your PayPal");
  }
  const confirm = { name: /Approve and take \$239\.00/ };
  // Both confirmations leave before either answer comes back.
  await Promise.all([
    page.getByRole("dialog").getByRole("button", confirm).click(),
    second.getByRole("dialog").getByRole("button", confirm).click(),
  ]);
  for (const tab of [page, second]) {
    await expect(tab.getByRole("region", { name: "Decided" })).toContainText("$239.00", {
      timeout: 15_000,
    });
  }
  // The tab that sent nothing is told, rather than left asking.
  const idle = third.getByRole("dialog");
  await expect(idle).toContainText(/This hold was already approved by you at \d\d:\d\d UTC\./, {
    timeout: 15_000,
  });
  await expect(idle.getByRole("button", confirm)).toBeDisabled();

  const holds = (await (await page.request.get("/api/v1/holds")).json()) as {
    decided: {
      view: { receiptId: string; state: { word: string }; chosen: { price: string } | null };
    }[];
  };
  const approved = holds.decided.find(
    (r) => r.view.state.word === "CAPTURED" && r.view.chosen?.price === "$239.00",
  );
  const id = approved?.view.receiptId ?? "";
  expect(id).not.toBe("");
  const detail = (await (await page.request.get(`/api/v1/receipts/${id}`)).json()) as {
    timeline: { to: string }[];
  };
  expect(detail.timeline.filter((t) => t.to === "CAPTURING")).toHaveLength(1);
  // The desk's history holds captures of its own, so this counts the calls for *this* receipt:
  // the stand-in's log names each one by the short number the receipt is filed under.
  const hex = id.replaceAll("-", "");
  const shortNo = `${hex.slice(0, 4)}…${hex.slice(-4)}`;
  const mine = (await paypalCalls(page)).filter((row) => row.includes(shortNo));
  expect(mine.filter((row) => row.includes("capture $239.00"))).toHaveLength(1);
});

test("the kill switch pulled during a checkout refuses the agent's next call and releases holds", async ({
  page,
}) => {
  await openDesk(page);
  const key = await issueKey(page, "scout");
  const shoe = await productId(page, "trail-shoe");
  const headphones = await productId(page, "headphones");
  const checkout = (product: string, url: string) =>
    page.request.post("/api/v1/agent/checkout", {
      headers: { authorization: `Bearer ${key}` },
      data: { productId: product, chosenOfferUrl: url, reason: "lowest listed price" },
    });

  await page.goto("/mandate");
  // In flight while the owner tears the slip: PayPal takes its time to answer.
  const inFlight = checkout(shoe, "https://store-b.example/p/trail-shoe");
  await page.getByLabel("Type REVOKE").fill("REVOKE");
  await page.getByRole("button", { name: "Tear the slip" }).click();
  await expect(
    page.getByText("Slip will not pay for anything else under this permission."),
  ).toBeVisible();

  // Whichever came first, the in-flight call got a real answer, never an error.
  expect([200, 403]).toContain((await inFlight).status());

  const next = await checkout(headphones, "https://store-k.example/p/headphones");
  expect(next.status()).toBe(403);
  expect(await next.json()).toMatchObject({ status: "refused", reason: "MANDATE_NOT_ACTIVE" });
  const holds = (await (await page.request.get("/api/v1/holds")).json()) as { pending: unknown[] };
  expect(holds.pending).toEqual([]);
});

/**
 * The diagram's INTERFACES panel asks for the approval screen's two actions over REST, not only
 * from the browser's own form (D82). Driven here the way a platform would: read the hold, price
 * it, approve it, and watch the owner's roll say so.
 */
test("a hold can be decided over REST, and the roll shows it without a reload", async ({
  page,
}) => {
  await openDesk(page);
  const pending = (await (await page.request.get("/api/v1/holds")).json()) as {
    pending: { view: { receiptId: string } }[];
  };
  expect(pending.pending.length).toBe(2);

  // The amount the owner would be shown. Approving without it is refused, by design.
  const id = pending.pending[0]?.view.receiptId ?? "";
  const preview = await page.request.post(`/api/v1/holds/${id}/preview`);
  expect(preview.status()).toBe(200);
  const quoted = (await preview.json()) as { kind: string; amountCents: number; store: string };
  expect(["capture", "pay"]).toContain(quoted.kind);

  const stale = await page.request.post(`/api/v1/holds/${id}/approve`, {
    data: { expectedAmountCents: quoted.amountCents - 1 },
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ reason: "PRICE_CHANGED" });

  const done = await page.request.post(`/api/v1/holds/${id}/approve`, {
    data: { expectedAmountCents: quoted.amountCents },
  });
  expect(done.status()).toBe(200);
  expect(await done.json()).toMatchObject({ status: "done" });

  // The owner's own page catches up on its own, because the change stamp moved.
  await page.goto("/holds");
  await expect(page.getByRole("region", { name: "Decided" })).toContainText("You approved at", {
    timeout: 15_000,
  });
  const after = (await (await page.request.get("/api/v1/holds")).json()) as { pending: unknown[] };
  expect(after.pending).toHaveLength(1);
});

test("nobody without a session can decide a hold", async ({ page, request }) => {
  await openDesk(page);
  const pending = (await (await page.request.get("/api/v1/holds")).json()) as {
    pending: { view: { receiptId: string } }[];
  };
  const id = pending.pending[0]?.view.receiptId ?? "";
  // A fresh request context carries no cookie: the same door the read API uses.
  for (const path of ["preview", "approve", "decline"]) {
    const answer = await request.post(`/api/v1/holds/${id}/${path}`, {
      data: { expectedAmountCents: 1_000 },
    });
    expect(answer.status(), path).toBe(401);
  }
  const after = (await (await page.request.get("/api/v1/holds")).json()) as { pending: unknown[] };
  expect(after.pending).toHaveLength(2);
});
