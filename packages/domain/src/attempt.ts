import { z } from "zod";
import { InvariantError } from "./errors.js";
import {
  type AgentId,
  type AttemptId,
  type MandateId,
  type PolicyVersion,
  uuidSchema,
} from "./ids.js";
import { CentsSchema } from "./money.js";
import { OfferSchema, type SelectedOption, SelectedOptionSchema } from "./offer.js";

/**
 * Every rule that can decide an attempt. The first twelve are the check's rules in evaluation
 * order: first match wins; the deciding rule is `ruleCode`, every rule that tripped is
 * `ruleCodes` (D9). `OWNER_APPROVED` is never produced by the check: it marks the follow-up
 * attempt created when an owner approves a hold that had no PayPal order (D21).
 */
export const RULE_CODES = [
  "R1_STALE_SNAPSHOT",
  "VARIANT_MISMATCH",
  "OFFER_NOT_FOUND",
  "CHOSEN_UNAVAILABLE",
  "CHOSEN_UNVERIFIED",
  "R2_TOO_FEW_OFFERS",
  "R3_STEERED",
  "R4_OVERPAID",
  "R4A_NO_CLASSIFIER_ANSWER",
  "R5_COMMISSION_CONFLICT",
  "R6_ABOVE_ORDER_CAP",
  "R7_WITHIN_LIMITS",
  "OWNER_APPROVED",
] as const;
export type RuleCode = (typeof RULE_CODES)[number];
export const RuleCodeSchema = z.enum(RULE_CODES);

export const OUTCOMES = ["PAID", "REJECTED", "HELD"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OutcomeSchema = z.enum(OUTCOMES);

/** The one place a rule code maps to an outcome. */
export const RULE_OUTCOME: Readonly<Record<RuleCode, Outcome>> = {
  R1_STALE_SNAPSHOT: "HELD",
  VARIANT_MISMATCH: "REJECTED",
  OFFER_NOT_FOUND: "REJECTED",
  CHOSEN_UNAVAILABLE: "REJECTED",
  CHOSEN_UNVERIFIED: "HELD",
  R2_TOO_FEW_OFFERS: "HELD",
  R3_STEERED: "REJECTED",
  R4_OVERPAID: "REJECTED",
  R4A_NO_CLASSIFIER_ANSWER: "HELD",
  R5_COMMISSION_CONFLICT: "HELD",
  R6_ABOVE_ORDER_CAP: "HELD",
  R7_WITHIN_LIMITS: "PAID",
  OWNER_APPROVED: "PAID",
};

/**
 * What the steering classifier said. `NOT_RUN` means the orchestrator did not call it (gap too
 * small, or it skipped it); `NO_ANSWER` means it was called and timed out, errored, refused, or
 * returned something that did not fit the schema. Both are treated as "no answer" by rule R4a.
 */
export const ClassifierAnswerSchema = z.union([
  z.object({ instruction_like: z.boolean() }),
  z.literal("NO_ANSWER"),
  z.literal("NOT_RUN"),
]);
export type ClassifierAnswer = z.infer<typeof ClassifierAnswerSchema>;

/**
 * What the agent sends to `checkout`, plus the agent id the server resolved from its key. There
 * is no price field on purpose: the server prices from its own snapshot. `reason` is stored and
 * shown; no rule reads it (D4).
 */
export const CheckoutRequestSchema = z.object({
  agentId: uuidSchema<"AgentId">(),
  productId: z.string().min(1),
  chosenOfferUrl: z.url(),
  selectedOptions: z.array(SelectedOptionSchema).optional(),
  reason: z.string().max(2000),
});
export type CheckoutRequest = z.infer<typeof CheckoutRequestSchema>;
export type CheckoutRequestInput = z.input<typeof CheckoutRequestSchema>;

/**
 * The full, serialisable record of one check. It is written before any PayPal call, is the body
 * of the receipt, and is what the benchmark replays. Fields are `null` when the check stopped
 * before they could be computed (no snapshot, offer not found, …).
 */
export const CheckResultSchema = z.object({
  policyVersion: z
    .number()
    .int()
    .min(1)
    .transform((v) => v as PolicyVersion),
  snapshotId: uuidSchema<"SnapshotId">().nullable(),
  snapshotFetchedAt: z.coerce.date().nullable(),
  /** Comparable offers including the chosen one (D5), after URL dedupe. */
  comparableCount: z.number().int().min(0),
  chosen: OfferSchema.nullable(),
  best: OfferSchema.nullable(),
  gapAbsCents: CentsSchema.nullable(),
  /** floor(gap / best · 10 000); display only. */
  gapPctHundredths: z.number().int().min(0).nullable(),
  conflict: z.boolean(),
  classifier: ClassifierAnswerSchema,
  ruleCodes: z.array(RuleCodeSchema).min(1),
  ruleCode: RuleCodeSchema,
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const DecisionSchema = z.object({
  outcome: OutcomeSchema,
  ruleCode: RuleCodeSchema,
  checkResult: CheckResultSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

/**
 * Version of the stored `CheckResult` shape. Bump it when the shape changes and add a branch to
 * `parseStoredCheckResult`, so receipts written by older code still read back exactly.
 */
export const CHECK_RESULT_VERSION = 1;

export function parseStoredCheckResult(version: number, json: unknown): CheckResult {
  switch (version) {
    case 1:
      return CheckResultSchema.parse(json);
    default:
      throw new InvariantError(`unknown check_result version ${version}`);
  }
}

/** AGENT: the agent asked to pay. OWNER_APPROVAL: the owner approved a hold that had no order. */
export const ATTEMPT_ORIGINS = ["AGENT", "OWNER_APPROVAL"] as const;
export type AttemptOrigin = (typeof ATTEMPT_ORIGINS)[number];

/**
 * One call to `checkout` and the decision Slip made about it. Immutable once written (the
 * database rejects UPDATE and DELETE). The attempt id is also the receipt id and the PayPal
 * `custom_id` / `invoice_id` of any payment it leads to.
 */
export interface Attempt {
  id: AttemptId;
  agentId: AgentId;
  mandateId: MandateId;
  productId: string;
  origin: AttemptOrigin;
  /** Set only for OWNER_APPROVAL: the HELD attempt the owner approved. */
  parentAttemptId: AttemptId | null;
  chosenOfferUrl: string;
  selectedOptions: SelectedOption[] | null;
  reason: string;
  decision: Decision;
  createdAt: Date;
}
