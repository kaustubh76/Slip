import { type AppDeps, listReceipts, ownerHolds, previewApproval } from "@slip/app";
import type { AttemptId, MandateId, OwnerId } from "@slip/domain";
import { beforeAll, describe, expect, it } from "vitest";
import { demoWorld } from "./__fixtures__/world";
import { deskSuffix, productIdFor } from "./catalogue";
import type { DemoFakes } from "./desk";
import { HISTORY_AGENTS } from "./history";
import { type DemoOwner, seedDemoOwner } from "./seed";

/**
 * The demo desk is built out of the real use cases, so this test is also a check that the mandate
 * flow, checkout and the hold decisions still hang together from outside the application package.
 */

const rowsOf = async (deps: AppDeps, mandateId: string) =>
  (await deps.store.attempts.listByMandate(mandateId as MandateId, { limit: 100 })).items;

const shapeOf = (r: Awaited<ReturnType<typeof rowsOf>>[number]) => ({
  outcome: r.attempt.decision.outcome,
  rule: r.attempt.decision.ruleCode,
  payment: r.payment?.status ?? "NONE",
  hold: r.hold?.status ?? null,
});

/** What shopper-1 did this morning. The roll opens on these, and the shot list is written to them. */
const TODAYS_FOUR = [
  // Cheapest: paid in one step.
  { outcome: "PAID", rule: "R7_WITHIN_LIMITS", payment: "CAPTURED", hold: null },
  // $11 over, and the pricier store pays more commission: refused, no PayPal order.
  { outcome: "REJECTED", rule: "R4_OVERPAID", payment: "NONE", hold: null },
  // Above the owner's cap: money reserved, waiting for them.
  { outcome: "HELD", rule: "R6_ABOVE_ORDER_CAP", payment: "AUTHORIZED", hold: "PENDING" },
  // Channel3 down: held with nothing reserved, the case approval pays in one step.
  { outcome: "HELD", rule: "R1_STALE_SNAPSHOT", payment: "NONE", hold: "PENDING" },
];

/** The rows sharing the newest timestamp: this morning's, whatever the history put under them. */
const newest = (rows: Awaited<ReturnType<typeof rowsOf>>) => {
  const at = Math.max(...rows.map((r) => r.attempt.createdAt.getTime()));
  return rows.filter((r) => r.attempt.createdAt.getTime() === at);
};

describe("seedDemoOwner", () => {
  let deps: AppDeps;
  let fakes: DemoFakes;
  let owner: DemoOwner;

  beforeAll(async () => {
    ({ deps, fakes } = demoWorld());
    owner = await seedDemoOwner(deps, fakes);
  });

  it("leaves a mandate PayPal has approved, with a method Slip can charge", async () => {
    const mandate = await deps.store.mandates.get(owner.mandateId as MandateId);
    expect(mandate).toMatchObject({ ownerId: owner.ownerId, status: "ACTIVE", hasVaultId: true });
    const vaultId = await deps.store.mandates.vaultIdForCharge(owner.mandateId as MandateId);
    expect(vaultId).not.toBeNull();
    expect(fakes.gateway.hasVault(vaultId ?? "")).toBe(true);
    // The real flow, not a shortcut: PayPal was asked to start and then to finish the setup.
    expect(fakes.gateway.callsTo("startVaultSetup")).toHaveLength(1);
    expect(fakes.gateway.callsTo("completeVaultSetup")).toHaveLength(1);
  });

  it("issues a key per agent, the owner's first, and stores none of them", async () => {
    expect(owner.apiKey.startsWith("slip_live_")).toBe(true);
    const agents = await deps.store.agents.listByMandate(owner.mandateId as MandateId);
    expect(agents.map((a) => a.name).sort()).toEqual([...HISTORY_AGENTS, "shopper-1"].sort());
    expect(JSON.stringify(agents)).not.toContain(owner.apiKey);
  });

  it("opens on this morning's four, one of each kind, on its own products", async () => {
    const rows = await rowsOf(deps, owner.mandateId);
    expect(newest(rows).map(shapeOf)).toEqual(expect.arrayContaining(TODAYS_FOUR));
    expect(newest(rows)).toHaveLength(4);
    for (const r of rows) {
      expect(r.attempt.productId.endsWith(`--${deskSuffix(owner.mandateId)}`)).toBe(true);
    }
    // The outage was this desk's alone, and it is over.
    expect(fakes.offers.isDown(productIdFor("standing-desk", owner.mandateId))).toBe(false);
  });

  /**
   * The reason the history exists: a four-row desk renders none of this. Each line here is a part
   * of the owner UI that had never been on a screen before it was seeded (D80).
   */
  it("and on a history deep enough to show the parts of the UI that need one", async () => {
    const rows = await rowsOf(deps, owner.mandateId);
    // Past a page of 25, so the roll offers "Older receipts →" at all.
    const page = await listReceipts(deps, owner.ownerId as OwnerId, owner.mandateId, {});
    expect(page?.rows.length).toBe(25);
    expect(page?.next).not.toBeNull();
    expect(rows.length).toBeGreaterThan(25);

    // Three UTC dates, so the roll prints a day separator rather than one heading.
    const days = new Set(rows.map((r) => r.attempt.createdAt.toISOString().slice(0, 10)));
    expect(days.size).toBe(3);

    // The payment words a desk that only ever succeeds never shows.
    const words = new Set(rows.map((r) => r.payment?.status ?? "NONE"));
    expect([...words].sort()).toEqual([
      "AUTHORIZED",
      "CAPTURED",
      "FAILED",
      "NONE",
      "PENDING",
      "VOIDED",
    ]);

    // Every rule an agent can trip, including the steering one the report card has a row for.
    const rules = new Set(rows.map((r) => r.attempt.decision.ruleCode));
    expect(rules).toContain("R3_STEERED");
  });

  it("leaves this morning's two holds waiting and every older one decided", async () => {
    const holds = await ownerHolds(deps, owner.ownerId as OwnerId, owner.mandateId);
    expect(holds?.pending).toHaveLength(2);
    // The in-tray's "Decided" section, which is empty on a desk with no history.
    expect(holds?.decided.length).toBeGreaterThan(0);
  });

  it("both waiting holds can actually be decided: one captures, one pays after a re-check", async () => {
    const held = (await rowsOf(deps, owner.mandateId)).filter((r) => r.hold?.status === "PENDING");
    expect(held).toHaveLength(2);
    const previews = await Promise.all(
      held.map(async (r) => previewApproval(deps, owner.ownerId as OwnerId, r.attempt.id)),
    );
    expect(previews.map((p) => (p.status === "preview" ? p.kind : p.reason)).sort()).toEqual([
      // Money is reserved: approving captures it.
      "capture",
      // Nothing reserved: approving checks today's prices and pays in one step.
      "pay",
    ]);
    expect(previews.find((p) => p.status === "preview" && p.kind === "pay")).toMatchObject({
      amountCents: 31_000,
    });
  });

  it("left nothing of this morning's at PayPal but the one charge and the one reservation", async () => {
    const mine = new Set(newest(await rowsOf(deps, owner.mandateId)).map((r) => r.attempt.id));
    const orders = fakes.gateway.orders().filter((o) => mine.has(o.invoiceId as AttemptId));
    expect(orders.filter((o) => o.intent === "CAPTURE")).toHaveLength(1);
    expect(orders.filter((o) => o.intent === "AUTHORIZE")).toHaveLength(1);
    // This morning's reservation is still a reservation: nothing captured it on the way in.
    expect(orders.filter((o) => o.intent === "AUTHORIZE" && o.capture !== null)).toEqual([]);
  });

  it("every demo desk is its own: nobody can read or revoke another's", async () => {
    const second = await seedDemoOwner(deps, fakes);
    expect(second.ownerId).not.toBe(owner.ownerId);
    expect(second.mandateId).not.toBe(owner.mandateId);
    const theirs = await rowsOf(deps, second.mandateId);
    const mine = new Set((await rowsOf(deps, owner.mandateId)).map((r) => r.attempt.id));
    expect(theirs.filter((r) => mine.has(r.attempt.id))).toEqual([]);
    const otherOwner = await deps.store.mandates.get(second.mandateId as MandateId);
    expect(otherOwner?.ownerId).not.toBe(owner.ownerId as OwnerId);
  });
});

describe("two visitors signing in at once", () => {
  it("each desk gets its own four and its own history: no outage or outcome leaks across", async () => {
    const { deps, fakes } = demoWorld();
    const desks = await Promise.all([
      seedDemoOwner(deps, fakes),
      seedDemoOwner(deps, fakes),
      seedDemoOwner(deps, fakes),
    ]);
    const counts = new Set<number>();
    for (const desk of desks) {
      const rows = await rowsOf(deps, desk.mandateId);
      expect(newest(rows).map(shapeOf)).toEqual(expect.arrayContaining(TODAYS_FOUR));
      expect(newest(rows)).toHaveLength(4);
      counts.add(rows.length);
    }
    // Every desk is the same desk: a visitor's receipts do not depend on who else signed in.
    expect(counts.size).toBe(1);
  });
});
