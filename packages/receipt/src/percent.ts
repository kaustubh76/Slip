import type { Cents } from "@slip/domain";

/**
 * Percentages people read at a glance: one decimal below 10 %, a whole number from 10 % up,
 * rounded half-up from exact integers, with a trailing ".0" dropped — "4.8%", "23%".
 *
 * A receipt that says a gap was above the owner's limit never prints a number at or below that
 * limit: decimals are added until the printed value is strictly above it ("5.001%", not "5%").
 * The owner's own limits and a store's commission are not computed, so they print exactly as set
 * (`formatPct`).
 */

const MAX_DECIMALS = 6;

const halfUp = (numerator: bigint, denominator: bigint): bigint =>
  (2n * numerator + denominator) / (2n * denominator);

/** `scaled` is the percent times 10^decimals. */
function render(scaled: bigint, decimals: number): string {
  if (decimals === 0) {
    return `${scaled}%`;
  }
  const digits = scaled.toString().padStart(decimals + 1, "0");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  const whole = digits.slice(0, -decimals);
  return fraction === "" ? `${whole}%` : `${whole}.${fraction}%`;
}

/**
 * `part` as a percent of `base`, both in cents. `above` (hundredths of a percent) is a limit the
 * sentence says the gap exceeds.
 */
export function gapPercent(part: Cents, base: Cents, options: { above?: number } = {}): string {
  if (base <= 0) {
    throw new Error("base must be positive");
  }
  const p = BigInt(part);
  const b = BigInt(base);
  let decimals = halfUp(p * 1_000n, b) >= 100n ? 0 : 1;
  const limit = options.above === undefined ? null : BigInt(options.above);
  const exceeds = limit !== null && p * 10_000n > limit * b;
  for (;;) {
    const scale = 10n ** BigInt(decimals);
    const shown = halfUp(p * 100n * scale, b);
    if (!exceeds || limit === null || shown * 100n > limit * scale || decimals >= MAX_DECIMALS) {
      return render(shown, decimals);
    }
    decimals += 1;
  }
}

/** A percent already stored in hundredths (the report card's medians), shown by the same rule. */
export function percentFromHundredths(value: number): string {
  const tenths = Math.floor((value + 5) / 10);
  return tenths >= 100 ? `${Math.floor((value + 50) / 100)}%` : render(BigInt(tenths), 1);
}
