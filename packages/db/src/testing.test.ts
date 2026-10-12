import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgliteTemplate } from "./testing.js";

describe("PgliteTemplate", () => {
  let template: PgliteTemplate;
  beforeAll(async () => {
    template = await PgliteTemplate.create();
  });
  afterAll(() => template.close());

  it("each clone is migrated and sees nothing another clone wrote", async () => {
    const a = await template.fresh();
    const b = await template.fresh();
    const now = new Date("2026-10-11T14:02:00Z");
    const id = "6a7a3c1e-0d2f-4b8e-9c61-3f1d2b9e8a01" as never;
    await a.store.owners.create({ id, email: "a@example.com", now });
    expect(await a.store.owners.get(id)).not.toBeNull();
    expect(await b.store.owners.get(id)).toBeNull();
    await a.close();
    await b.close();
  });
});
