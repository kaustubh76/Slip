import { MAX_PRICE_CENTS } from "@slip/domain";
import { z } from "zod";

/**
 * What a server action accepts from the browser. Actions are public endpoints — anyone can post
 * to them with any arguments — so each one checks its input before it reaches a use case, and a bad
 * input is a plain refusal rather than a thrown error.
 */

export const ReceiptIdSchema = z.string().trim().min(1).max(64);
export const AgentIdSchema = z.string().trim().min(1).max(64);
export const AmountCentsSchema = z.number().int().positive().max(MAX_PRICE_CENTS);
export const AgentNameSchema = z.string().max(200);
export const RevokeWordSchema = z.string().max(40);
export const PolicyVersionSchema = z.number().int().min(1);

const percent = z.number().min(0).max(1000);
const dollars = z
  .number()
  .min(0)
  .max(MAX_PRICE_CENTS / 100);

/** The limits form, in the units people type: percent, dollars, minutes. */
export const LimitsInputSchema = z
  .object({
    maxOverpayPct: percent,
    maxOverpayDollars: dollars,
    flagPct: percent,
    orderCapDollars: dollars,
    snapshotMaxAgeMinutes: z
      .number()
      .min(0)
      .max(24 * 60),
  })
  .strict();
export type LimitsInput = z.infer<typeof LimitsInputSchema>;

export interface InvalidRequest {
  status: "refused";
  reason: "INVALID_REQUEST";
  message: string;
}

export const invalidRequest = (what: string): InvalidRequest => ({
  status: "refused",
  reason: "INVALID_REQUEST",
  message: `That request was not understood (${what}).`,
});
