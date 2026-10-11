import { z } from "zod";
import type { Branded } from "./brand.js";
import { InvalidMoneyError } from "./errors.js";

/** Integer US cents. Never a float, never negative. */
export type Cents = Branded<number, "Cents">;

/** Integer hundredths of a percent: 5 % is 500, 7.5 % is 750, 1 % is 100. */
export type PctHundredths = Branded<number, "PctHundredths">;

/** $1,000,000.00 — upper bound for any price, gap or owner limit. */
export const MAX_PRICE_CENTS = 100_000_000;

/** 1000 % — upper bound for any percent threshold. */
export const MAX_PCT_HUNDREDTHS = 100_000;

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PRICE_CENTS) {
    throw new InvalidMoneyError(`not a cents value in [0, ${MAX_PRICE_CENTS}]: ${String(value)}`);
  }
  return value as Cents;
}

export function pctHundredths(value: number): PctHundredths {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PCT_HUNDREDTHS) {
    throw new InvalidMoneyError(
      `not a percent in hundredths within [0, ${MAX_PCT_HUNDREDTHS}]: ${String(value)}`,
    );
  }
  return value as PctHundredths;
}

/** zod schema for a non-negative cents value (gaps, limits). */
export const CentsSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_PRICE_CENTS)
  .transform((n) => n as Cents);

/** zod schema for a price: strictly positive cents. */
export const PositiveCentsSchema = z
  .number()
  .int()
  .positive()
  .max(MAX_PRICE_CENTS)
  .transform((n) => n as Cents);

export const PctHundredthsSchema = z
  .number()
  .int()
  .min(0)
  .max(MAX_PCT_HUNDREDTHS)
  .transform((n) => n as PctHundredths);

/**
 * Channel3 prices arrive as JSON floats in dollars (`129.99`). A price must be positive and have
 * at most two decimals; `1.005` is rejected rather than rounded, because it is not a cents value.
 * Multiplying by 100 and rounding is exact for every two-decimal float (`4.35 * 100` is
 * `434.99999999999994`, which rounds to 435 and sits well inside the 1e-6 guard).
 */
export function parseUsdNumberToCents(value: number): Cents {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InvalidMoneyError(`not a finite number: ${String(value)}`);
  }
  if (value <= 0) {
    throw new InvalidMoneyError(`price must be positive: ${value}`);
  }
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (Math.abs(scaled - rounded) >= 1e-6) {
    throw new InvalidMoneyError(`more than two decimals: ${value}`);
  }
  return cents(rounded);
}

/** Optional `$`, digits with optional thousands separators in groups of three, up to 2 decimals. */
const USD_PATTERN = /^\$?(\d{1,3}(?:,\d{3})*|\d{1,9})(?:\.(\d{1,2}))?$/;

/**
 * Owner-entered amounts: `"47.99"`, `"$1,000"`, `"0"`. Zero is allowed (a limit can be zero);
 * negatives, more than two decimals, and commas that are not thousands separators are not.
 */
export function parseUsdStringToCents(input: string): Cents {
  const match = USD_PATTERN.exec(input.trim());
  if (match === null) {
    throw new InvalidMoneyError(`not a USD amount: ${input}`);
  }
  const whole = Number((match[1] ?? "0").replace(/,/g, ""));
  const fraction = Number((match[2] ?? "").padEnd(2, "0"));
  return cents(whole * 100 + fraction);
}

/** `4799` → `"$47.99"`, `123456789` → `"$1,234,567.89"`. */
export function formatUsd(value: Cents): string {
  const dollars = Math.floor(value / 100);
  const rest = value % 100;
  return `$${dollars.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}

/** `500` → `"5%"`, `750` → `"7.5%"`, `1234` → `"12.34%"`. */
export function formatPct(value: number): string {
  const whole = Math.floor(value / 100);
  const rest = value % 100;
  if (rest === 0) {
    return `${whole}%`;
  }
  const digits = String(rest).padStart(2, "0").replace(/0$/, "");
  return `${whole}.${digits}%`;
}

/**
 * Channel3's `max_commission_rate` is a fraction (`0.05` = 5 %). Returns basis points, or `null`
 * when the value is missing or outside [0, 1] — unknown, which never counts as a conflict.
 */
export function commissionToBps(rate: number | null | undefined): number | null {
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1) {
    return null;
  }
  return Math.round(rate * 10_000);
}

/**
 * `gapAbs / base > threshold`, evaluated without division: `gapAbs · 10 000 > threshold · base`.
 * Strict: a gap of exactly 5 % does not exceed a 5 % threshold. This is the only place a percent
 * comparison happens.
 */
export function gapExceedsPct(gapAbs: Cents, base: Cents, threshold: PctHundredths): boolean {
  if (base <= 0) {
    throw new InvalidMoneyError("base price must be positive");
  }
  return gapAbs * 10_000 > threshold * base;
}

/** `floor(gapAbs / base · 10 000)` — for display and reports only; rules never use it. */
export function gapPctHundredthsFloor(gapAbs: Cents, base: Cents): number {
  if (base <= 0) {
    throw new InvalidMoneyError("base price must be positive");
  }
  return Math.floor((gapAbs * 10_000) / base);
}
