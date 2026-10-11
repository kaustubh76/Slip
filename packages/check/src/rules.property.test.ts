import {
  type ClassifierAnswer,
  DEFAULT_POLICY,
  type Decision,
  type Offer,
  type Policy,
  policyWith,
  RULE_OUTCOME,
  snapshotId,
} from "@slip/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NOW, request, snapshot, testUuid } from "./__fixtures__/builders.js";
import { comparableOffers } from "./comparable.js";
import { pickBest } from "./compute.js";
import { decide } from "./decide.js";
import { prepareCheck } from "./prepare.js";

/** A market: distinct stores with a price in cents and a commission; the agent picks one. */
interface Market {
  offers: Offer[];
  chosen: Offer;
  classifier: ClassifierAnswer;
}

const arbOfferSpec = fc.record({
  slug: fc.nat({ max: 1_000_000 }),
  priceCents: fc.integer({ min: 1, max: 1_000_000 }),
  bps: fc.option(fc.integer({ min: 0, max: 10_000 }), { nil: null }),
});

function toOffer(spec: { slug: number; priceCents: number; bps: number | null }): Offer {
  const domain = `s${spec.slug}.example`;
  return {
    url: `https://${domain}/p`,
    domain,
    priceCents: spec.priceCents as Offer["priceCents"],
    currency: "USD",
    availability: "InStock",
    condition: "new",
    commissionBps: spec.bps,
    listingText: null,
  };
}

const arbClassifier: fc.Arbitrary<ClassifierAnswer> = fc.constantFrom<ClassifierAnswer>(
  { instruction_like: true },
  { instruction_like: false },
  "NO_ANSWER",
  "NOT_RUN",
);

const arbMarket: fc.Arbitrary<Market> = fc
  .tuple(
    fc.uniqueArray(arbOfferSpec, { minLength: 2, maxLength: 8, selector: (s) => s.slug }),
    fc.nat(),
    arbClassifier,
  )
  .map(([specs, pick, classifier]) => {
    const offers = specs.map(toOffer);
    const chosen = offers[pick % offers.length];
    if (chosen === undefined) {
      throw new Error("unreachable: offers has at least two entries");
    }
    return { offers, chosen, classifier };
  });

function run(
  market: Market,
  offers: Offer[] = market.offers,
  policy: Policy = DEFAULT_POLICY,
): Decision {
  // A fixed snapshot id: the builder mints a new one per call, which would make the
  // determinism property compare ids instead of decisions.
  const fixed = { ...snapshot({ offers }), id: snapshotId(testUuid(0x9809)), rawHash: "hash-prop" };
  const prepared = prepareCheck({
    snapshot: fixed,
    request: request({ url: market.chosen.url }),
    policy,
    now: NOW,
  });
  return prepared.kind === "ready"
    ? decide(prepared, policy, market.classifier)
    : prepared.decision;
}

function shuffled<T>(items: readonly T[]): fc.Arbitrary<T[]> {
  return fc.shuffledSubarray([...items], { minLength: items.length, maxLength: items.length });
}

describe("check properties", () => {
  it("is deterministic: the same input always yields the same decision", () => {
    fc.assert(
      fc.property(arbMarket, (market) => {
        expect(run(market)).toEqual(run(market));
      }),
    );
  });

  it("the gap is never negative and the outcome always agrees with the rule code", () => {
    fc.assert(
      fc.property(arbMarket, (market) => {
        const decision = run(market);
        expect(decision.outcome).toBe(RULE_OUTCOME[decision.ruleCode]);
        expect(decision.checkResult.ruleCodes[0]).toBe(decision.ruleCode);
        expect(decision.checkResult.ruleCodes).toContain(decision.ruleCode);
        const gap = decision.checkResult.gapAbsCents;
        if (gap !== null) {
          expect(gap).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("choosing the cheapest offer is never steered, overpaid, held for no answer or conflict", () => {
    fc.assert(
      fc.property(arbMarket, (market) => {
        const best = pickBest(comparableOffers(market.offers));
        if (best === null) {
          return;
        }
        const decision = run({ ...market, chosen: best });
        expect(["R6_ABOVE_ORDER_CAP", "R7_WITHIN_LIMITS"]).toContain(decision.ruleCode);
        expect(decision.checkResult.gapAbsCents).toBe(0);
      }),
    );
  });

  it("raising every threshold never turns PAID into anything else", () => {
    fc.assert(
      fc.property(
        arbMarket,
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (market, pctUp, absUp, capUp) => {
          const before = run(market);
          if (before.outcome !== "PAID") {
            return;
          }
          const looser = policyWith(DEFAULT_POLICY, {
            maxOverpayPctHundredths: DEFAULT_POLICY.maxOverpayPctHundredths + pctUp,
            maxOverpayAbsCents: DEFAULT_POLICY.maxOverpayAbsCents + absUp,
            flagPctHundredths: DEFAULT_POLICY.flagPctHundredths + pctUp,
            orderCapCents: DEFAULT_POLICY.orderCapCents + capUp,
          });
          expect(run(market, market.offers, looser).outcome).toBe("PAID");
        },
      ),
    );
  });

  it("the order Channel3 returns offers in never changes the decision", () => {
    fc.assert(
      fc.property(
        arbMarket.chain((market) => fc.tuple(fc.constant(market), shuffled(market.offers))),
        ([market, permuted]) => {
          const a = run(market);
          const b = run(market, permuted);
          expect(b.outcome).toBe(a.outcome);
          expect(b.ruleCode).toBe(a.ruleCode);
          expect(b.checkResult.ruleCodes).toEqual(a.checkResult.ruleCodes);
          expect(b.checkResult.best?.url).toBe(a.checkResult.best?.url);
          expect(b.checkResult.gapAbsCents).toBe(a.checkResult.gapAbsCents);
          expect(b.checkResult.conflict).toBe(a.checkResult.conflict);
        },
      ),
    );
  });

  it("scaling every price by the same factor keeps every percent-based judgement", () => {
    fc.assert(
      fc.property(arbMarket, fc.constantFrom(2, 3, 7, 10), (market, factor) => {
        const scale = (offer: Offer): Offer => ({
          ...offer,
          priceCents:
            offer.priceCents === null ? null : ((offer.priceCents * factor) as Offer["priceCents"]),
        });
        const scaledOffers = market.offers.map(scale);
        const scaledChosen = scale(market.chosen);
        const a = run(market);
        const b = run({ ...market, offers: scaledOffers, chosen: scaledChosen });
        // Steering and conflict depend only on the percent gap and the classifier.
        expect(b.checkResult.ruleCodes.includes("R3_STEERED")).toBe(
          a.checkResult.ruleCodes.includes("R3_STEERED"),
        );
        expect(b.checkResult.ruleCodes.includes("R5_COMMISSION_CONFLICT")).toBe(
          a.checkResult.ruleCodes.includes("R5_COMMISSION_CONFLICT"),
        );
        expect(b.checkResult.ruleCodes.includes("R4A_NO_CLASSIFIER_ANSWER")).toBe(
          a.checkResult.ruleCodes.includes("R4A_NO_CLASSIFIER_ANSWER"),
        );
        expect(b.checkResult.conflict).toBe(a.checkResult.conflict);
      }),
    );
  });

  it("the classifier is recorded as NOT_RUN whenever the gap is on or under the flag line", () => {
    fc.assert(
      fc.property(arbMarket, (market) => {
        const decision = run(market);
        const gap = decision.checkResult.gapAbsCents;
        const best = decision.checkResult.best?.priceCents ?? null;
        if (gap === null || best === null) {
          return;
        }
        const aboveLine = gap * 10_000 > DEFAULT_POLICY.flagPctHundredths * best;
        if (!aboveLine) {
          expect(decision.checkResult.classifier).toBe("NOT_RUN");
        } else {
          expect(decision.checkResult.classifier).toEqual(market.classifier);
        }
      }),
    );
  });
});
