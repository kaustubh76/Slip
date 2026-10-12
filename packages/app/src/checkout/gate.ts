import { normalizeOfferUrl, variantMatches } from "@slip/check";
import {
  type AgentAuth,
  type AttemptId,
  type CheckoutRequest,
  CheckoutRequestSchema,
  IN_FLIGHT_PAYMENT_STATUSES,
  type PolicyVersion,
  type Receipt,
} from "@slip/domain";
import type { z } from "zod";
import type { AppConfig } from "../config.js";
import type { AppDeps } from "../deps.js";
import { hashApiKey } from "../keys.js";

export type RefusalReason =
  | "UNAUTHENTICATED"
  | "MANDATE_NOT_ACTIVE"
  | "INVALID_REQUEST"
  | "BUSY"
  | "RETRY_LIMIT"
  | "NOT_FOUND";

/** An agent's call is refused; nothing about it is recorded. */
export interface Refusal {
  status: "refused";
  reason: RefusalReason;
  message: string;
  /** For RETRY_LIMIT: the latest receipt for this product. */
  receiptId: AttemptId | null;
}

export const refuse = (
  reason: RefusalReason,
  message: string,
  receiptId: AttemptId | null = null,
): Refusal => ({ status: "refused", reason, message, receiptId });

/**
 * What the agent sends to `checkout`. The agent is identified by its key, not by a field; any
 * other field — a price, say — is dropped: Slip prices from its own snapshot.
 */
export const CheckoutInputSchema = CheckoutRequestSchema.omit({ agentId: true });
export type CheckoutInput = z.input<typeof CheckoutInputSchema>;

/** The key must belong to an unrevoked agent whose mandate is ACTIVE. */
export async function authenticate(deps: AppDeps, apiKey: string): Promise<AgentAuth | Refusal> {
  const auth = await deps.store.agents.authenticate(hashApiKey(apiKey));
  if (auth === null) {
    return refuse("UNAUTHENTICATED", "Unknown or revoked API key.");
  }
  if (auth.mandate.status !== "ACTIVE") {
    return refuse(
      "MANDATE_NOT_ACTIVE",
      auth.mandate.status === "REVOKED"
        ? "The owner has revoked this agent's spending mandate."
        : "The owner has not finished setting up PayPal yet.",
    );
  }
  return auth;
}

export function parseCheckoutRequest(auth: AgentAuth, input: unknown): CheckoutRequest | Refusal {
  const parsed = CheckoutInputSchema.safeParse(input);
  if (!parsed.success) {
    return refuse(
      "INVALID_REQUEST",
      parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
    );
  }
  return { ...parsed.data, agentId: auth.agent.id };
}

export type ReplayReason = "ALREADY_PAID" | "HOLD_OPEN" | "RECENTLY_REJECTED";

export type DedupeVerdict =
  | { kind: "proceed" }
  | { kind: "replay"; reason: ReplayReason; receipt: Receipt }
  | { kind: "retry-limit"; latest: Receipt };

/** A purchase that is paid or may still be: blocks buying the same product again. */
const LIVE_PAYMENT = new Set<string>([...IN_FLIGHT_PAYMENT_STATUSES, "CAPTURED"]);

function sameOffer(request: CheckoutRequest, receipt: Receipt): boolean {
  const attempt = receipt.attempt;
  const a = normalizeOfferUrl(request.chosenOfferUrl) ?? request.chosenOfferUrl;
  const b = normalizeOfferUrl(attempt.chosenOfferUrl) ?? attempt.chosenOfferUrl;
  const options = attempt.selectedOptions ?? [];
  return (
    a === b &&
    variantMatches(request.selectedOptions, options) &&
    variantMatches(options.length === 0 ? undefined : options, request.selectedOptions ?? [])
  );
}

/**
 * Decides, before any work, whether this checkout repeats one Slip already handled. Pure.
 * `recent` is every attempt for this agent and product since the longer of the two windows,
 * newest first; `openHolds` every PENDING hold for them, at any age.
 *
 * 1. Paid, or a payment still in flight, within the dedupe window → that receipt (no double buy).
 * 2. An open hold at any age → that receipt (no second authorization).
 * 3. The same offer rejected within the dedupe window under the same policy version → that
 *    rejection (a loosened policy deserves a fresh check).
 * 4. Too many agent attempts within the retry window → refused.
 */
export function dedupe(input: {
  request: CheckoutRequest;
  policyVersion: PolicyVersion;
  now: Date;
  config: AppConfig;
  recent: readonly Receipt[];
  openHolds: readonly Receipt[];
}): DedupeVerdict {
  const { request, policyVersion, now, config, recent, openHolds } = input;
  const within = (receipt: Receipt, windowMs: number) =>
    now.getTime() - receipt.attempt.createdAt.getTime() < windowMs;

  const paid = recent.find(
    (r) =>
      within(r, config.dedupeWindowMs) &&
      r.attempt.decision.outcome === "PAID" &&
      r.payment !== null &&
      LIVE_PAYMENT.has(r.payment.status),
  );
  if (paid !== undefined) {
    return { kind: "replay", reason: "ALREADY_PAID", receipt: paid };
  }

  const [hold] = openHolds;
  if (hold !== undefined) {
    return { kind: "replay", reason: "HOLD_OPEN", receipt: hold };
  }

  const rejected = recent.find(
    (r) =>
      within(r, config.dedupeWindowMs) &&
      r.attempt.origin === "AGENT" &&
      r.attempt.decision.outcome === "REJECTED" &&
      r.attempt.decision.checkResult.policyVersion === policyVersion &&
      sameOffer(request, r),
  );
  if (rejected !== undefined) {
    return { kind: "replay", reason: "RECENTLY_REJECTED", receipt: rejected };
  }

  const own = recent.filter((r) => r.attempt.origin === "AGENT" && within(r, config.retryWindowMs));
  const [latest] = own;
  if (latest !== undefined && own.length >= config.maxAttemptsPerRetryWindow) {
    return { kind: "retry-limit", latest };
  }
  return { kind: "proceed" };
}
