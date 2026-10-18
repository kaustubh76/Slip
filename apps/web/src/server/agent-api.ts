import type { CheckoutResult } from "@slip/app";
import type { ReceiptView } from "@slip/receipt";

/**
 * The agent's side of the wire. One endpoint, one key, and an answer an agent can act on without
 * reading prose: the outcome, whether money moved, and the receipt the owner will see.
 *
 * The status code says what the agent should do:
 * - 200 — Slip decided (paid, rejected or held), or replayed a decision it had already made.
 * - 400 — the request was not a checkout.
 * - 401 — the key is unknown or revoked.
 * - 403 — the key is good but the owner's permission is not in force.
 * - 409 — another checkout for this product is in flight; try again.
 * - 429 — too many attempts for this product within the hour; the last decision stands.
 */

export interface AgentCheckoutBody {
  status: "decided" | "replayed" | "refused";
  /** PAID, REJECTED or HELD, when Slip decided. */
  outcome?: ReceiptView["outcome"];
  /** The rule that decided it. */
  rule?: ReceiptView["ruleCode"];
  /** True only when money moved. */
  charged?: boolean;
  receiptId?: string;
  /** The receipt as the owner reads it, so an agent can explain itself in the same words. */
  receipt?: ReceiptView;
  /** Why this was a replay of an earlier decision, or why it was refused. */
  reason?: string;
  message?: string;
}

export interface AgentResponse {
  status: number;
  body: AgentCheckoutBody;
}

const REFUSAL_STATUS: Record<string, number> = {
  UNAUTHENTICATED: 401,
  MANDATE_NOT_ACTIVE: 403,
  INVALID_REQUEST: 400,
  BUSY: 409,
  RETRY_LIMIT: 429,
  NOT_FOUND: 404,
};

export function checkoutResponse(result: CheckoutResult): AgentResponse {
  if (result.status === "refused") {
    return {
      status: REFUSAL_STATUS[result.reason] ?? 400,
      body: { status: "refused", reason: result.reason, message: result.message },
    };
  }
  const view = result.view;
  return {
    status: 200,
    body: {
      status: result.status,
      outcome: view.outcome,
      rule: view.ruleCode,
      charged: view.state.charged,
      receiptId: view.receiptId,
      receipt: view,
      ...(result.status === "replayed" ? { reason: result.reason } : {}),
    },
  };
}
