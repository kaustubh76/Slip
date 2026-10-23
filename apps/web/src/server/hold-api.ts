import "server-only";
import { approveHold, declineHold, previewApproval } from "@slip/app";
import { cents } from "@slip/domain";
import { AmountCentsSchema, invalidRequest, ReceiptIdSchema } from "./action-input";
import {
  type DecisionResult,
  decisionResult,
  type PreviewResult,
  previewResult,
} from "./hold-results";
import { answer, type JsonAnswer } from "./json";
import type { OwnerContext } from "./owner";

/**
 * The owner's side of the wire for a hold: the approval screen's two actions, reachable by
 * something other than a browser, which is what the diagram's INTERFACES panel asks for and what
 * the app had only as server actions (D82). Same use cases, same guards, same three shapes.
 *
 * The status code says what the caller should do:
 * - 200 — Slip decided; the body carries the receipt as the owner reads it.
 * - 202 — Slip sent the decision and never heard back. **The money may well have moved.** Read the
 *   receipt before sending this again; a second decision is the one thing that could pay twice.
 * - 400 — the body was not a hold decision.
 * - 401 — no session.
 * - 403 — the permission is not in force, or the agent's key was revoked.
 * - 404 — no such hold under this owner. Another owner's is the same answer as one that never was.
 * - 409 — the hold is not in the state the caller assumed: already decided, expired, the price
 *   moved, or a decision is already in flight. Nothing was written; read it again before retrying.
 * - 503 — Slip could not price the purchase to approve it. Nothing was written; try later.
 */

type Owner = Pick<OwnerContext, "deps" | "ownerId">;

const REFUSAL_STATUS: Record<string, number> = {
  INVALID_REQUEST: 400,
  MANDATE_NOT_ACTIVE: 403,
  AGENT_REVOKED: 403,
  NOT_FOUND: 404,
  ALREADY_DECIDED: 409,
  EXPIRED: 409,
  NOT_READY: 409,
  PRICE_CHANGED: 409,
  RECHECK_REJECTED: 409,
  BUSY: 409,
  // The one refusal that means "try later" rather than "your view of the world is stale".
  PRICES_UNAVAILABLE: 503,
};

/** One of `hold-results`' three shapes, as an HTTP answer. */
export function holdAnswer(result: DecisionResult | PreviewResult): JsonAnswer {
  if (result.status === "refused") {
    return answer(REFUSAL_STATUS[result.reason] ?? 400, result);
  }
  if (result.status === "unknown") {
    return answer(202, {
      status: "unknown",
      message:
        "Slip sent the decision and did not hear back. Read the receipt before sending it again.",
    });
  }
  return answer(200, result);
}

/**
 * Never a 500 from a money command: an answer that was lost may still have moved the money, so the
 * caller is told to read the receipt rather than handed an error that invites a retry (D48).
 */
async function guarded(
  owner: Owner,
  id: string,
  what: string,
  run: () => Promise<JsonAnswer>,
): Promise<JsonAnswer> {
  try {
    return await run();
  } catch (error) {
    owner.deps.log.error(`web.${what}_failed`, { attemptId: id, error: String(error) });
    return holdAnswer({ status: "unknown" });
  }
}

/** What approving would charge, and which way it would be paid. */
export async function previewAnswer(owner: Owner, id: string): Promise<JsonAnswer> {
  if (!ReceiptIdSchema.safeParse(id).success) {
    return answer(400, invalidRequest("receipt"));
  }
  return guarded(owner, id, "preview", async () =>
    holdAnswer(previewResult(await previewApproval(owner.deps, owner.ownerId, id))),
  );
}

/**
 * `expectedAmountCents` is not a formality: it is what the owner saw when they decided, and
 * approving at a price that has since moved is refused rather than quietly charged.
 */
export async function approveAnswer(owner: Owner, id: string, body: unknown): Promise<JsonAnswer> {
  const amount = AmountCentsSchema.safeParse(
    (body as { expectedAmountCents?: unknown } | null)?.expectedAmountCents,
  );
  if (!ReceiptIdSchema.safeParse(id).success || !amount.success) {
    return answer(400, invalidRequest("receipt or amount"));
  }
  return guarded(owner, id, "approve", async () =>
    holdAnswer(
      decisionResult(
        await approveHold(owner.deps, owner.ownerId, id, {
          expectedAmountCents: cents(amount.data),
        }),
      ),
    ),
  );
}

/** No body: declining is the same whatever the price has done, and a release is never a charge. */
export async function declineAnswer(owner: Owner, id: string): Promise<JsonAnswer> {
  if (!ReceiptIdSchema.safeParse(id).success) {
    return answer(400, invalidRequest("receipt"));
  }
  return guarded(owner, id, "decline", async () =>
    holdAnswer(decisionResult(await declineHold(owner.deps, owner.ownerId, id))),
  );
}
