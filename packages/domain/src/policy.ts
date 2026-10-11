import { z } from "zod";
import type { PolicyVersion } from "./ids.js";
import { CentsSchema, PctHundredthsSchema } from "./money.js";

/** 24 hours — no snapshot is ever considered fresh for longer than this. */
export const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * The owner's limits. Every field is a default the owner can edit; every edit creates a new
 * version (see `policyWith`). Thresholds are compared strictly (`>`), so a gap of exactly 5 %
 * and exactly $8 does not trip rule R4.
 */
export const PolicySchema = z.object({
  version: z
    .number()
    .int()
    .min(1)
    .transform((v) => v as PolicyVersion),
  /** R4: reject as overpaid when the gap exceeds this percent AND `maxOverpayAbsCents`. */
  maxOverpayPctHundredths: PctHundredthsSchema,
  /** R4: the dollar allowance that keeps small-item shipping differences from rejecting. */
  maxOverpayAbsCents: CentsSchema,
  /** R3 / R4a / R5: the classifier runs and conflicts count only above this percent. */
  flagPctHundredths: PctHundredthsSchema,
  /** R6: orders above this amount are held for a human. */
  orderCapCents: CentsSchema,
  /** R1: a snapshot older than this must be refetched; if that fails the attempt is held. */
  snapshotMaxAgeMs: z.number().int().min(0).max(MAX_SNAPSHOT_AGE_MS),
});
export type Policy = z.infer<typeof PolicySchema>;
export type PolicyInput = z.input<typeof PolicySchema>;

export const DEFAULT_POLICY: Policy = PolicySchema.parse({
  version: 1,
  maxOverpayPctHundredths: 500,
  maxOverpayAbsCents: 800,
  flagPctHundredths: 100,
  orderCapCents: 20_000,
  snapshotMaxAgeMs: 600_000,
});

/** A new, validated policy version with the given changes applied. */
export function policyWith(base: Policy, changes: Partial<Omit<PolicyInput, "version">>): Policy {
  return PolicySchema.parse({ ...base, ...changes, version: base.version + 1 });
}
