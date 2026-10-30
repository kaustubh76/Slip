import { RULE_OUTCOME } from "@slip/domain";
import { describe, expect, it } from "vitest";
import { offer, runCheck, snapshot } from "./__fixtures__/builders.js";

/**
 * R2b and R5a: the two merchant-side holes of docs/MERCHANTS.md §2, closed. Both hold rather than
 * reject — in each case the comparison is incomplete, and the agent's choice is not what is in
 * doubt (D68's reasoning, applied to the seller rather than to the gap).
 */

describe("R2b a market of one seller", () => {
  it("holds when every comparable offer is the same seller under two hosts", () => {
    // Before this rule the count of offers was the market, so a seller on two storefronts cleared
    // R2, `pickBest` compared its listing with its own, and the purchase was paid unattended.
    const parent = offer({ price: 100.0, domain: "example.com" });
    const child = offer({ price: 100.0, domain: "shop.example.com" });
    const check = runCheck({
      snapshot: snapshot({ offers: [parent, child] }),
      chosen: child.url,
    });
    expect(check.ruleCode).toBe("R2B_SINGLE_SELLER_MARKET");
    expect(RULE_OUTCOME[check.ruleCode]).toBe("HELD");
  });

  it("pays as before when the two offers are genuinely two sellers", () => {
    const a = offer({ price: 100.0, domain: "surlatable.com" });
    const b = offer({ price: 100.0, domain: "williams-sonoma.com" });
    const check = runCheck({ snapshot: snapshot({ offers: [a, b] }), chosen: b.url });
    expect(check.ruleCode).toBe("R7_WITHIN_LIMITS");
  });

  it("is satisfied by one independent seller beside a collapsed pair", () => {
    const parent = offer({ price: 120.0, domain: "example.com" });
    const child = offer({ price: 125.0, domain: "shop.example.com" });
    const rival = offer({ price: 119.0, domain: "rival.example" });
    const check = runCheck({
      snapshot: snapshot({ offers: [parent, child, rival] }),
      chosen: parent.url,
    });
    expect(check.ruleCode).not.toBe("R2B_SINGLE_SELLER_MARKET");
  });

  it("leaves R2 to speak first when there is only one offer at all", () => {
    const only = offer({ price: 100.0, domain: "example.com" });
    const check = runCheck({ snapshot: snapshot({ offers: [only] }), chosen: only.url });
    expect(check.ruleCode).toBe("R2_TOO_FEW_OFFERS");
  });

  it("holds a purchase the gap rules would have rejected, because the gap was never a market", () => {
    // $100 against $200 would be R4_OVERPAID — "the identical item was listed cheaper elsewhere".
    // It was not listed cheaper elsewhere; it was listed cheaper by the same seller, so the claim
    // the rejection rests on is false and the owner decides instead.
    const cheap = offer({ price: 100.0, domain: "example.com" });
    const dear = offer({ price: 200.0, domain: "shop.example.com" });
    const check = runCheck({ snapshot: snapshot({ offers: [cheap, dear] }), chosen: dear.url });
    expect(check.ruleCode).toBe("R2B_SINGLE_SELLER_MARKET");
    expect(RULE_OUTCOME[check.ruleCode]).toBe("HELD");
  });
});

describe("R5a a rate the chosen store did not give", () => {
  /**
   * A real market: a cheaper store that disclosed, and a dearer one the agent picked. The gap sits
   * above the flag line, where commission is looked at, and inside the overpay allowance, so R4
   * does not decide first.
   */
  function market(chosenRate: number | null) {
    const best = offer({ price: 100.0, domain: "best.example", rate: 0.02 });
    const chosen = offer({ price: 103.0, domain: "chosen.example", rate: chosenRate });
    return { snapshot: snapshot({ offers: [best, chosen] }), chosen: chosen.url };
  }

  it("holds when the chosen store reported no rate", () => {
    const check = runCheck(market(null));
    expect(check.ruleCode).toBe("R5A_COMMISSION_UNDISCLOSED");
    expect(RULE_OUTCOME[check.ruleCode]).toBe("HELD");
  });

  it("holds when it reported zero, which is what Channel3 sends for no data (D3)", () => {
    const check = runCheck(market(0));
    expect(check.ruleCode).toBe("R5A_COMMISSION_UNDISCLOSED");
  });

  it("leaves the conflict rule to decide when both rates are known", () => {
    const check = runCheck(market(0.08));
    expect(check.ruleCode).toBe("R5_COMMISSION_CONFLICT");
  });

  it("does not fire when the chosen store pays less than the cheaper one", () => {
    const best = offer({ price: 100.0, domain: "best.example", rate: 0.08 });
    const chosen = offer({ price: 103.0, domain: "chosen.example", rate: 0.02 });
    const check = runCheck({ snapshot: snapshot({ offers: [best, chosen] }), chosen: chosen.url });
    expect(check.ruleCode).toBe("R7_WITHIN_LIMITS");
  });

  it("asks only the store being paid to speak, not the one that lost", () => {
    // The conflict of interest belongs to the offer the money goes to. A silent cheaper store
    // leaves nothing to compare against and no transaction at stake, so it holds nothing up.
    const best = offer({ price: 100.0, domain: "best.example", rate: null });
    const chosen = offer({ price: 103.0, domain: "chosen.example", rate: 0.02 });
    const check = runCheck({ snapshot: snapshot({ offers: [best, chosen] }), chosen: chosen.url });
    expect(check.ruleCode).toBe("R7_WITHIN_LIMITS");
  });

  it("says nothing below the flag line, where no rule looks at commission", () => {
    const best = offer({ price: 100.0, domain: "best.example", rate: 0.02 });
    const chosen = offer({ price: 100.5, domain: "chosen.example", rate: null });
    const check = runCheck({ snapshot: snapshot({ offers: [best, chosen] }), chosen: chosen.url });
    expect(check.ruleCode).toBe("R7_WITHIN_LIMITS");
  });
});
