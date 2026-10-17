import { decide, prepareCheck } from "@slip/check";
import { type CheckResult, DEFAULT_POLICY, type OfferSnapshot } from "@slip/domain";
import { NOW, offer, request, snapshot } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { offerRows } from "./offers.js";
import { OfferRowSchema } from "./schema.js";

/** The check's own result for a choice on a snapshot, the way the orchestrator runs it. */
function checked(snap: OfferSnapshot, chosenUrl: string): CheckResult {
  const prepared = prepareCheck({
    snapshot: snap,
    request: request({ url: chosenUrl }),
    policy: DEFAULT_POLICY,
    now: NOW,
  });
  return prepared.kind === "ready"
    ? decide(prepared, DEFAULT_POLICY, { instruction_like: false }).checkResult
    : prepared.decision.checkResult;
}

describe("offerRows", () => {
  const a = offer({
    price: 58.99,
    domain: "store-a.example",
    url: "https://store-a.example/p/1",
    rate: 0.08,
  });
  const b = offer({
    price: 47.99,
    domain: "store-b.example",
    url: "https://store-b.example/p/1",
    rate: 0.02,
  });
  const out = offer({ price: 40, domain: "store-d.example", availability: "OutOfStock" });
  const used = offer({ price: 39, domain: "store-e.example", condition: "used" });
  const unstated = offer({ price: 41, domain: "store-f.example", condition: null });
  const unpriced = offer({ price: null, domain: "store-g.example" });
  const euro = offer({ price: 42, domain: "store-h.example", currency: "EUR" });
  const twice = { ...b, url: "https://store-b.example/p/1?utm_source=feed" };
  const snap = snapshot({ offers: [a, b, out, used, unstated, unpriced, euro, twice] });

  it("names every offer, the lowest and the chosen, and why each other one was left out", () => {
    const result = checked(snap, a.url);
    const rows = offerRows(snap, result);
    expect(rows.map((r) => [r.store, r.price, r.best, r.chosen, r.notCompared])).toEqual([
      ["Store A", "$58.99", false, true, null],
      ["Store B", "$47.99", true, false, null],
      ["Store D", "$40.00", false, false, "out of stock"],
      ["Store E", "$39.00", false, false, "used"],
      ["Store F", "$41.00", false, false, "condition not stated"],
      ["Store G", null, false, false, "price unknown"],
      ["Store H", "$42.00", false, false, "other currency"],
      ["Store B", "$47.99", false, false, "listed twice"],
    ]);
    expect(rows[0]).toMatchObject({ commission: "8%", inStock: true, condition: "new" });
    // The table compares exactly what the check compared.
    expect(rows.filter((r) => r.compared)).toHaveLength(result.comparableCount);
    for (const row of rows) {
      expect(OfferRowSchema.parse(row)).toEqual(row);
    }
  });

  it("when the listing was too old, nothing was compared", () => {
    const old = snapshot({ offers: [a, b], fetchedAt: new Date(NOW.getTime() - 3_600_000) });
    const result = checked(old, a.url);
    expect(result.ruleCode).toBe("R1_STALE_SNAPSHOT");
    const rows = offerRows(old, result);
    expect(rows.map((r) => r.notCompared)).toEqual(["prices too old", "prices too old"]);
    expect(rows.every((r) => !r.compared)).toBe(true);
  });

  it("offers a link only to an http(s) address, and nothing without a snapshot", () => {
    const odd = offer({ price: 10, domain: "store-x.example", url: "ftp://store-x.example/p" });
    const rows = offerRows(
      snapshot({ offers: [odd] }),
      checked(snapshot({ offers: [odd] }), odd.url),
    );
    expect(rows[0]?.link).toBeNull();
    expect(offerRows(snap, checked(snap, a.url))[0]?.link).toBe(a.url);
    expect(offerRows(null, checked(snap, a.url))).toEqual([]);
  });
});
