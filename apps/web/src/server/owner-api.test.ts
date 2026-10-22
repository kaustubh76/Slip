import { DEFAULT_PAGE_SIZE } from "@slip/app";
import {
  AgentCardSchema,
  HoldsSchema,
  MandateSummarySchema,
  PolicyViewSchema,
  ReceiptDetailSchema,
  ReceiptPageSchema,
} from "@slip/receipt";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { demoWorld } from "./demo/__fixtures__/world";
import { seedDemoOwner } from "./demo/seed";
import {
  agentsAnswer,
  holdsAnswer,
  mandateAnswer,
  policiesAnswer,
  receiptAnswer,
  receiptsAnswer,
} from "./owner-api";

describe("the owner's read API", () => {
  const world = demoWorld();
  let owner: { deps: typeof world.deps; ownerId: never; mandateId: string };
  let stranger: typeof owner;

  beforeAll(async () => {
    const mine = await seedDemoOwner(world.deps, world.fakes);
    const theirs = await seedDemoOwner(world.deps, world.fakes);
    owner = { deps: world.deps, ownerId: mine.ownerId as never, mandateId: mine.mandateId };
    stranger = { deps: world.deps, ownerId: theirs.ownerId as never, mandateId: theirs.mandateId };
  });

  it("answers every page in its wire shape", async () => {
    const roll = await receiptsAnswer(owner, new URLSearchParams());
    expect(roll.status).toBe(200);
    const page = ReceiptPageSchema.parse(roll.body);
    // A page, not the desk: a seeded desk holds more receipts than one page shows.
    expect(page.rows).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(page.next).not.toBeNull();
    const first = page.rows[0]?.view.receiptId ?? "";
    expect(ReceiptDetailSchema.parse((await receiptAnswer(owner, first)).body).view.receiptId).toBe(
      first,
    );
    expect(HoldsSchema.parse((await holdsAnswer(owner)).body).pending).toHaveLength(2);
    z.object({ agents: z.array(AgentCardSchema) }).parse((await agentsAnswer(owner)).body);
    z.object({ versions: z.array(PolicyViewSchema) }).parse((await policiesAnswer(owner)).body);
    expect(MandateSummarySchema.parse((await mandateAnswer(owner)).body).status).toBe("ACTIVE");
  });

  it("pages with a limit and a cursor", async () => {
    const first = ReceiptPageSchema.parse(
      (await receiptsAnswer(owner, new URLSearchParams({ limit: "3" }))).body,
    );
    expect(first.rows).toHaveLength(3);
    const rest = ReceiptPageSchema.parse(
      (await receiptsAnswer(owner, new URLSearchParams({ limit: "3", before: first.next ?? "" })))
        .body,
    );
    expect(rest.rows).toHaveLength(3);
    // The cursor moves: the second page is three receipts nobody has seen yet.
    const seen = new Set(first.rows.map((r) => r.view.receiptId));
    expect(rest.rows.filter((r) => seen.has(r.view.receiptId))).toEqual([]);
  });

  it("another owner's receipt, or a made-up one, is a 404", async () => {
    const theirs = ReceiptPageSchema.parse(
      (await receiptsAnswer(stranger, new URLSearchParams())).body,
    );
    const id = theirs.rows[0]?.view.receiptId ?? "";
    expect((await receiptAnswer(owner, id)).status).toBe(404);
    expect((await receiptAnswer(owner, "not-a-receipt")).status).toBe(404);
    expect((await receiptsAnswer(owner, new URLSearchParams({ agent: "nobody" }))).status).toBe(
      404,
    );
  });
});
