import { cents, DEFAULT_POLICY, type Policy, policyWith } from "@slip/domain";

/**
 * The owner's limits the benchmark runs under, and why they are not the product's defaults.
 *
 * Everything is the default except the order cap, which is raised to $2,000 — above the dearest
 * errand (a $1,099 office chair). With the shipped $200 cap, the two Norda errands are HELD by
 * R6_ABOVE_ORDER_CAP whatever the agent chose, and the "with Slip on" column would be measuring
 * the size of the purchase rather than the quality of the comparison. The question SlipBench asks
 * is whether an agent overpays and whether Slip catches it, so the cap is moved out of the way and
 * said so in the report.
 *
 * The overpay thresholds are untouched: 5 % and $8, the shipped defaults, because those are the
 * numbers the claim rests on.
 */
export const BENCH_POLICY: Policy = policyWith(DEFAULT_POLICY, {
  orderCapCents: cents(200_000),
});

export const BENCH_POLICY_NOTE =
  "The owner's limits are the shipped defaults — reject above 5 % and $8, flag above 1 % — with the" +
  " order cap raised to $2,000 so that it never decides an errand on size instead of price.";
