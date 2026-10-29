import { describe, expect, it } from "vitest";
import { SlipClientError } from "./data/client.js";
import { FakeSlipClient } from "./fake.js";

/**
 * The fake, on its own. What it has to be is a *whole* Slip that behaves like one: a command
 * changes what the next read answers, and the states a real server reaches only by accident —
 * a lost answer, a stale version, a price that moved — can be asked for on purpose.
 */

describe("the seeded Slip", () => {
  it("comes populated, with every outcome on the roll and a hold waiting", async () => {
    const slip = new FakeSlipClient();
    const page = await slip.receipts();
    expect(new Set(page.rows.map((row) => row.view.outcome))).toEqual(
      new Set(["PAID", "REJECTED", "HELD"]),
    );
    const holds = await slip.holds();
    expect(holds.pending.length).toBeGreaterThan(0);
    expect((await slip.agents()).length).toBe(2);
    expect((await slip.policies()).length).toBe(2);
    expect((await slip.mandate()).status).toBe("ACTIVE");
  });

  it("takes a roll of its own, and pages through it", async () => {
    const slip = new FakeSlipClient();
    const all = (await slip.receipts()).rows;
    const first = await slip.receipts({ limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.next).toBe(all[1]?.view.receiptId);
    const second = await slip.receipts({ limit: 2, before: first.next });
    expect(second.rows.map((row) => row.view.receiptId)).toEqual([
      all[2]?.view.receiptId,
      all[3]?.view.receiptId,
    ]);
  });

  it("filters the roll by agent, as the API does", async () => {
    const slip = new FakeSlipClient();
    const mine = (await slip.receipts()).rows[0]?.agent.id as string;
    const page = await slip.receipts({ agent: mine });
    expect(page.rows.every((row) => row.agent.id === mine)).toBe(true);
    expect(page.rows.length).toBeLessThan((await slip.receipts()).rows.length);
  });

  it("answers for a receipt it has no canned detail for, as the server would", async () => {
    const slip = new FakeSlipClient();
    const id = (await slip.receipts()).rows[0]?.view.receiptId as string;
    const detail = await slip.receipt(id);
    expect(detail.view.receiptId).toBe(id);
    await expect(slip.receipt("no-such-receipt")).rejects.toThrow(SlipClientError);
  });
});

describe("the states that are otherwise hard to reach", () => {
  it("fails one read and then recovers, because an error is a state and not a mode", async () => {
    const slip = new FakeSlipClient().failNext("signed-out");
    await expect(slip.holds()).rejects.toMatchObject({ kind: "signed-out", status: 401 });
    await expect(slip.holds()).resolves.toBeDefined();
  });

  it("waits when told to, so a loading state exists long enough to design", async () => {
    const slip = new FakeSlipClient().delay(30);
    const started = Date.now();
    await slip.mandate();
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("gives up on a read whose caller gave up", async () => {
    const slip = new FakeSlipClient().delay(1_000);
    const stop = new AbortController();
    const reading = slip.mandate(stop.signal);
    stop.abort();
    await expect(reading).rejects.toThrow();
  });

  it("answers `unknown` on request, which is the answer nothing else can produce", async () => {
    // `safeCommands` manufactures this when a command's answer is lost. The UI must never send the
    // command again on its own (D48), so it is the branch most worth being able to look at.
    const slip = new FakeSlipClient();
    slip.refuseNext("approveHold", { status: "unknown" });
    const id = (await slip.holds()).pending[0]?.view.receiptId as string;
    expect(await slip.commands.approveHold(id, 1)).toEqual({ status: "unknown" });
    // One call only.
    expect((await slip.commands.approveHold(id, 0)).status).not.toBe("unknown");
  });

  it("records what it was asked, in order", async () => {
    const slip = new FakeSlipClient();
    await slip.holds();
    await slip.mandate();
    await slip.holds();
    expect(slip.calls).toEqual(["holds", "mandate", "holds"]);
    expect(slip.asked("holds")).toBe(2);
  });
});

describe("a command changes what the next read says", () => {
  it("takes an approved hold out of the tray", async () => {
    const slip = new FakeSlipClient();
    const waiting = (await slip.holds()).pending[0];
    const id = waiting?.view.receiptId as string;
    const preview = await slip.commands.previewApproval(id);
    expect(preview.status).toBe("preview");
    const amount = preview.status === "preview" ? preview.amountCents : -1;

    expect((await slip.commands.approveHold(id, amount)).status).toBe("done");
    const after = await slip.holds();
    expect(after.pending.map((row) => row.view.receiptId)).not.toContain(id);
    expect(after.decided.map((row) => row.view.receiptId)).toContain(id);
    expect((await slip.mandate()).pendingHolds).toBe(0);
  });

  it("refuses an approval at the wrong amount, naming the amount it would charge", async () => {
    const slip = new FakeSlipClient();
    const id = (await slip.holds()).pending[0]?.view.receiptId as string;
    const answer = await slip.commands.approveHold(id, 1);
    expect(answer).toMatchObject({ status: "refused", reason: "PRICE_CHANGED" });
    expect(answer.status === "refused" ? answer.amountCents : null).toBeGreaterThan(0);
  });

  it("adds a limits version and moves the mandate on to it", async () => {
    const slip = new FakeSlipClient();
    const current = (await slip.policies())[0]?.version as number;
    const answer = await slip.commands.updateLimits(
      {
        maxOverpayPct: 7,
        maxOverpayDollars: 12,
        flagPct: 1,
        orderCapDollars: 300,
        snapshotMaxAgeMinutes: 15,
      },
      current,
    );
    expect(answer).toEqual({ status: "updated", version: current + 1 });
    const after = await slip.policies();
    expect(after[0]).toMatchObject({ version: current + 1, orderCapCents: 30_000 });
    expect((await slip.mandate()).policyVersion).toBe(current + 1);
  });

  it("refuses limits based on a version that is no longer the latest", async () => {
    const slip = new FakeSlipClient();
    const stale = ((await slip.policies())[0]?.version as number) - 1;
    expect(
      await slip.commands.updateLimits(
        {
          maxOverpayPct: 1,
          maxOverpayDollars: 1,
          flagPct: 1,
          orderCapDollars: 1,
          snapshotMaxAgeMinutes: 1,
        },
        stale,
      ),
    ).toMatchObject({ status: "refused", reason: "STALE_VERSION" });
  });

  it("empties the tray when the mandate is revoked, and only on the typed word", async () => {
    const slip = new FakeSlipClient();
    expect(await slip.commands.revokeMandate("revoke")).toMatchObject({ status: "refused" });
    const waiting = (await slip.holds()).pending.length;
    const answer = await slip.commands.revokeMandate("REVOKE");
    expect(answer).toMatchObject({ status: "revoked", holdsDeclined: waiting });
    expect((await slip.holds()).pending).toEqual([]);
    expect(await slip.mandate()).toMatchObject({ status: "REVOKED", hasSavedMethod: false });
  });

  it("issues a key that is obviously not a key, and counts the agent", async () => {
    const slip = new FakeSlipClient();
    const before = (await slip.mandate()).agents;
    const answer = await slip.commands.issueKey("new-shopper");
    expect(answer).toMatchObject({ status: "issued", name: "new-shopper" });
    expect(answer.status === "issued" ? answer.apiKey : "").toContain("not_a_real_key");
    expect((await slip.mandate()).agents).toBe(before + 1);
  });

  it("stamps a revoked key with the time it was revoked", async () => {
    const slip = new FakeSlipClient();
    const id = (await slip.agents())[0]?.agent.id as string;
    expect(await slip.commands.revokeKey(id)).toEqual({ status: "revoked" });
    const card = (await slip.agents()).find((candidate) => candidate.agent.id === id);
    expect(card?.agent.revokedAt).not.toBeNull();
  });

  it("moves the change stamp whenever something moved", async () => {
    const slip = new FakeSlipClient();
    const before = await slip.stamp();
    await slip.commands.issueKey("another");
    expect(await slip.stamp()).not.toBe(before);
  });
});
