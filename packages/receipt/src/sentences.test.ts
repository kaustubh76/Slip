import { DEFAULT_POLICY, type Offer, RULE_CODES, type RuleCode } from "@slip/domain";
import { NOW, offer, snapshot, testAttempt, testDecision, testUuid } from "@slip/domain/testing";
import { describe, expect, it } from "vitest";
import { shortNo } from "./format.js";
import { verdict } from "./sentences.js";
import { storeName } from "./store-name.js";

function verdictFor(
  ruleCode: RuleCode,
  options: { chosen?: Offer | null; parent?: string | null; snapshot?: boolean } = {},
) {
  const chosen = options.chosen === undefined ? offer({ price: 250 }) : options.chosen;
  const attempt = {
    ...testAttempt({
      decision: testDecision({ ruleCode, chosen }),
      ...(options.parent === undefined ? {} : { parentAttemptId: options.parent as never }),
    }),
    selectedOptions: [{ name: "Color", label: "White" }],
  };
  return verdict({
    attempt,
    chosen:
      chosen?.priceCents == null
        ? null
        : {
            domain: chosen.domain,
            store: storeName(chosen.domain),
            url: chosen.url,
            priceCents: chosen.priceCents,
            price: `$${(chosen.priceCents / 100).toFixed(2)}`,
            commission: null,
          },
    chosenOffer: chosen,
    policy: DEFAULT_POLICY,
    snapshot: options.snapshot
      ? snapshot({ offers: [], selected: [{ name: "Color", label: "Black" }] })
      : null,
  });
}

describe("verdict", () => {
  it.each<[RuleCode, string]>([
    ["R7_WITHIN_LIMITS", "Within your limits."],
    ["R4_OVERPAID", "Payment rejected. Nothing was charged."],
    [
      "R3_STEERED",
      "The listing text read like instructions to the agent. Payment rejected. Nothing was charged.",
    ],
    [
      "OFFER_NOT_FOUND",
      "That offer was not in Channel3's listing for this item. Payment rejected. Nothing was charged.",
    ],
    ["R1_STALE_SNAPSHOT", "No fresh listed item prices were available. Held for you."],
    [
      "R2_TOO_FEW_OFFERS",
      "No other comparable offer was listed, so the price could not be checked. Held for you.",
    ],
    ["R4A_NO_CLASSIFIER_ANSWER", "The steering check gave no answer in time. Held for you."],
    [
      "R5_COMMISSION_CONFLICT",
      "The pricier store pays your agent's platform more commission. Held for you.",
    ],
    ["R6_ABOVE_ORDER_CAP", "$250.00 is above your $200.00 order cap. Held for you."],
  ])("%s → %s", (ruleCode, expected) => {
    expect(verdictFor(ruleCode)).toBe(expected);
  });

  it("a variant mismatch names both variants when the snapshot is known", () => {
    expect(verdictFor("VARIANT_MISMATCH", { snapshot: true })).toBe(
      "Your agent asked for Color: White but this listing is Color: Black. Payment rejected. Nothing was charged.",
    );
    expect(verdictFor("VARIANT_MISMATCH")).toBe(
      "Your agent asked for Color: White, which is not the variant Channel3 listed. Payment rejected. Nothing was charged.",
    );
  });

  it("an unavailable offer says why", () => {
    expect(
      verdictFor("CHOSEN_UNAVAILABLE", {
        chosen: offer({ price: 20, availability: "OutOfStock" }),
      }),
    ).toBe("That offer was out of stock. Payment rejected. Nothing was charged.");
    expect(
      verdictFor("CHOSEN_UNAVAILABLE", { chosen: offer({ price: 20, condition: "used" }) }),
    ).toBe("That offer was listed as used. Payment rejected. Nothing was charged.");
  });

  it("an unverified offer says what was unclear, and a foreign price is called that", () => {
    expect(verdictFor("CHOSEN_UNVERIFIED", { chosen: offer({ price: 20, currency: "EUR" }) })).toBe(
      "The listing is priced in EUR, not US dollars. Held for you.",
    );
    expect(verdictFor("CHOSEN_UNVERIFIED", { chosen: offer({ price: null }) })).toBe(
      "The listing did not state the price clearly. Held for you.",
    );
    expect(verdictFor("CHOSEN_UNVERIFIED", { chosen: offer({ price: 20, condition: null }) })).toBe(
      "The listing did not state the condition clearly. Held for you.",
    );
  });

  it("an owner approval names the hold it paid for, and claims no payment itself", () => {
    const parent = testUuid();
    expect(verdictFor("OWNER_APPROVED", { parent })).toBe(
      `You approved hold no. ${shortNo(parent)} at ${NOW.toISOString().slice(11, 16)} UTC; Slip checked the price again first.`,
    );
  });

  it("no verdict claims money moved: that is the state line's job", () => {
    for (const ruleCode of RULE_CODES) {
      expect(verdictFor(ruleCode)).not.toMatch(/\bPaid\b|\bcharged \$/);
    }
  });
});

describe("storeName", () => {
  it.each([
    ["store-a.example", "Store A"],
    ["store-12.example", "Store 12"],
    ["www.rei.com", "rei.com"],
    ["WWW.Zappos.com", "zappos.com"],
    ["shop.example.org", "shop.example.org"],
  ])("%s → %s", (domain, name) => {
    expect(storeName(domain)).toBe(name);
  });
});
