import type { AppDeps } from "@slip/app";
import type { OwnerId } from "@slip/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { demoWorld } from "./demo/__fixtures__/world";
import { seedDemoOwner } from "./demo/seed";
import { approveAnswer, declineAnswer, previewAnswer } from "./hold-api";
import { holdsAnswer } from "./owner-api";

/**
 * The owner's hold decisions over REST (D82). The use cases behind these are tested in
 * `@slip/app`; what is checked here is the wire: who may call, what each refusal is worth as a
 * status code, and that a second decision cannot pay twice.
 */

type Owner = { deps: AppDeps; ownerId: OwnerId; mandateId: string };

const pendingOf = async (owner: Owner) => {
  const answer = await holdsAnswer(owner);
  const body = answer.body as { pending: { view: { receiptId: string } }[] };
  return body.pending;
};

/** The amount the owner would be shown before deciding, as `/preview` reports it. */
const previewed = async (owner: Owner, id: string) => {
  const answer = await previewAnswer(owner, id);
  return { status: answer.status, body: answer.body as Record<string, unknown> };
};

describe("the owner's hold API", () => {
  let world: ReturnType<typeof demoWorld>;
  let owner: Owner;
  let stranger: Owner;

  beforeEach(async () => {
    world = demoWorld();
    const mine = await seedDemoOwner(world.deps, world.fakes);
    const theirs = await seedDemoOwner(world.deps, world.fakes);
    owner = { deps: world.deps, ownerId: mine.ownerId as OwnerId, mandateId: mine.mandateId };
    stranger = {
      deps: world.deps,
      ownerId: theirs.ownerId as OwnerId,
      mandateId: theirs.mandateId,
    };
  });

  it("prices an approval before it is made, and says how it would be paid", async () => {
    const pending = await pendingOf(owner);
    expect(pending.length).toBe(2);
    const kinds = await Promise.all(
      pending.map(async (row) => (await previewed(owner, row.view.receiptId)).body["kind"]),
    );
    // One hold has money reserved to collect; the other has nothing, so approving pays in one step.
    expect([...kinds].sort()).toEqual(["capture", "pay"]);
  });

  it("approves at the amount the owner was shown", async () => {
    const [first] = await pendingOf(owner);
    const id = first?.view.receiptId ?? "";
    const preview = await previewed(owner, id);
    expect(preview.status).toBe(200);
    const done = await approveAnswer(owner, id, {
      expectedAmountCents: preview.body["amountCents"],
    });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "done" });
  });

  it("decides once however many times it is called", async () => {
    // The double click the diagram's H6 asks about. A repeat is not refused — it reports where
    // things stand, which is what a caller that lost its answer needs — but it starts nothing:
    // one capture for one approval, and a decline afterwards changes nothing either.
    const pending = await pendingOf(owner);
    const reserved = (
      await Promise.all(
        pending.map(async (row) => ({
          id: row.view.receiptId,
          kind: (await previewed(owner, row.view.receiptId)).body["kind"],
        })),
      )
    ).find((row) => row.kind === "capture");
    const id = reserved?.id ?? "";
    const amount = (await previewed(owner, id)).body["amountCents"];
    expect((await approveAnswer(owner, id, { expectedAmountCents: amount })).status).toBe(200);
    const again = await approveAnswer(owner, id, { expectedAmountCents: amount });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: "done" });
    const declined = await declineAnswer(owner, id);
    expect(declined.status).toBe(409);
    expect(declined.body).toMatchObject({ status: "refused", reason: "ALREADY_DECIDED" });
    // Counted for this receipt alone: the desk's own history decided holds of its own.
    const mine = world.fakes.gateway.callsFor(owner.mandateId).filter((c) => c.attemptId === id);
    expect(mine.filter((c) => c.call === "capture")).toHaveLength(1);
    expect(mine.filter((c) => c.call === "void")).toEqual([]);
  });

  it("refuses an amount that is not the one on the preview, and says what it is now", async () => {
    const [first] = await pendingOf(owner);
    const id = first?.view.receiptId ?? "";
    const amount = Number((await previewed(owner, id)).body["amountCents"]);
    const wrong = await approveAnswer(owner, id, { expectedAmountCents: amount - 1 });
    expect(wrong.status).toBe(409);
    expect(wrong.body).toMatchObject({ status: "refused", reason: "PRICE_CHANGED" });
    // And it carries the real figure, so the caller can show it rather than guess.
    expect((wrong.body as { amountCents?: number }).amountCents).toBe(amount);
  });

  it("declines a hold, and the money is released", async () => {
    const [first] = await pendingOf(owner);
    const id = first?.view.receiptId ?? "";
    const done = await declineAnswer(owner, id);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: "done" });
    expect((await pendingOf(owner)).length).toBe(1);
  });

  it("another owner's hold is a 404, the same as one that never existed", async () => {
    const [mine] = await pendingOf(owner);
    const id = mine?.view.receiptId ?? "";
    for (const answer of [
      await previewAnswer(stranger, id),
      await approveAnswer(stranger, id, { expectedAmountCents: 1_000 }),
      await declineAnswer(stranger, id),
      await declineAnswer(owner, "11111111-1111-4111-8111-111111111111"),
    ]) {
      expect(answer.status).toBe(404);
    }
    // And it is still waiting for the owner it belongs to.
    expect((await pendingOf(owner)).length).toBe(2);
  });

  it("a body that is not a decision is a 400, before any use case runs", async () => {
    const [first] = await pendingOf(owner);
    const id = first?.view.receiptId ?? "";
    for (const body of [null, {}, { expectedAmountCents: "lots" }, { expectedAmountCents: -1 }]) {
      const answer = await approveAnswer(owner, id, body);
      expect(answer.status).toBe(400);
      expect(answer.body).toMatchObject({ reason: "INVALID_REQUEST" });
    }
    expect((await pendingOf(owner)).length).toBe(2);
  });
});
