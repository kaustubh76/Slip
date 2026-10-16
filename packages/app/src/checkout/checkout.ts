import {
  type AgentAuth,
  type CheckoutRequest,
  type ClassifierAnswer,
  ConflictError,
  LeaseLostError,
  MandateNotActiveError,
  type OfferSnapshot,
  PolicyChangedError,
  type Receipt,
  type RecordedAttempt,
} from "@slip/domain";
import { type ReceiptView, renderReceipt } from "@slip/receipt";
import type { AppDeps } from "../deps.js";
import { orderDescription, sendOrder } from "../payments.js";
import { checkOffers, currentSnapshot, recordInputFor } from "./decision.js";
import {
  authenticate,
  dedupe,
  parseCheckoutRequest,
  type Refusal,
  type ReplayReason,
  refuse,
} from "./gate.js";

export type CheckoutResult =
  | { status: "decided"; receipt: Receipt; view: ReceiptView }
  | { status: "replayed"; reason: ReplayReason; receipt: Receipt; view: ReceiptView }
  | Refusal;

/**
 * Renders a receipt with the policy version it was decided under, for an approved hold the
 * owner-approval attempt that paid for it (looked up unless the caller already has it), and for a
 * variant mismatch the snapshot that names the listed variant.
 */
export async function viewOf(
  deps: AppDeps,
  receipt: Receipt,
  known: { child?: Receipt | null } = {},
): Promise<ReceiptView> {
  const policy = await deps.store.mandates.policy(
    receipt.attempt.mandateId,
    receipt.attempt.decision.checkResult.policyVersion,
  );
  const child =
    known.child !== undefined
      ? known.child
      : receipt.hold?.status === "APPROVED"
        ? await deps.store.attempts.findChild(receipt.attempt.id)
        : null;
  // Only a variant mismatch quotes the snapshot (to name the listed variant).
  const { ruleCode, checkResult } = receipt.attempt.decision;
  const snapshot =
    ruleCode === "VARIANT_MISMATCH" && checkResult.snapshotId !== null
      ? await deps.store.snapshots.get(checkResult.snapshotId)
      : null;
  return renderReceipt(receipt, { ...(policy === null ? {} : { policy }), child, snapshot });
}

/**
 * The `checkout` call: an agent asks to pay for an offer and Slip decides — pay, reject, or hold
 * for the owner — before any money moves.
 *
 * Gate (key, ACTIVE mandate, valid request) → lease on (agent, product), or BUSY → replay a
 * repeat → snapshot → check → record the decision with its write-ahead payment → only then the
 * PayPal order, with the request id and vault id the record returned → map PayPal's answer →
 * release the lease. A timeout leaves the payment UNKNOWN for the resolver; it is never re-sent
 * here and never turned into a new order.
 */
export async function runCheckout(
  deps: AppDeps,
  apiKey: string,
  input: unknown,
): Promise<CheckoutResult> {
  const auth = await authenticate(deps, apiKey);
  if ("status" in auth) {
    return auth;
  }
  const request = parseCheckoutRequest(auth, input);
  if ("status" in request) {
    return request;
  }

  const holder = deps.ids.uuid();
  const key = { agentId: auth.agent.id, productId: request.productId };
  const acquired = await deps.store.leases.acquire(
    key,
    holder,
    deps.config.leaseTtlMs,
    deps.clock.now(),
  );
  if (!acquired) {
    return refuse("BUSY", "Another checkout for this product is in progress. Try again shortly.");
  }
  try {
    return await checkoutUnderLease(deps, auth, request, holder);
  } finally {
    await deps.store.leases.release(key, holder);
  }
}

async function checkoutUnderLease(
  deps: AppDeps,
  auth: AgentAuth,
  request: CheckoutRequest,
  holder: string,
): Promise<CheckoutResult> {
  const { store, config } = deps;
  const started = deps.clock.now();
  const since = new Date(started.getTime() - Math.max(config.dedupeWindowMs, config.retryWindowMs));
  const [recent, openHolds] = await Promise.all([
    store.attempts.listRecent(auth.agent.id, request.productId, since),
    store.holds.listOpen(auth.agent.id, request.productId),
  ]);
  const verdict = dedupe({
    request,
    policyVersion: auth.policy.version,
    now: started,
    config,
    recent,
    openHolds,
  });
  if (verdict.kind === "replay") {
    deps.log.info("checkout.replayed", {
      attemptId: verdict.receipt.attempt.id,
      reason: verdict.reason,
    });
    return {
      status: "replayed",
      reason: verdict.reason,
      receipt: verdict.receipt,
      view: await viewOf(deps, verdict.receipt),
    };
  }
  if (verdict.kind === "retry-limit") {
    return refuse(
      "RETRY_LIMIT",
      `At most ${config.maxAttemptsPerRetryWindow} attempts per product per hour. The last decision stands.`,
      verdict.latest.attempt.id,
    );
  }

  let policy = auth.policy;
  const { snapshot } = await currentSnapshot(deps, request, policy, started);
  let reuse: ClassifierAnswer | undefined;
  for (let round = 1; round <= 2; round += 1) {
    const now = deps.clock.now();
    const checked = await checkOffers(deps, {
      request,
      policy,
      snapshot,
      now,
      ...(reuse === undefined ? {} : { reuse }),
    });
    reuse = checked.classifier === "NOT_RUN" ? undefined : checked.classifier;
    const input = recordInputFor(deps, {
      auth,
      request,
      decision: checked.decision,
      now,
      leaseHolder: holder,
    });
    let recorded: RecordedAttempt;
    try {
      recorded = await store.attempts.record(input);
    } catch (error) {
      if (error instanceof PolicyChangedError && round === 1) {
        // The owner changed the limits while this was being checked: check again under them.
        policy = await store.mandates.currentPolicy(auth.mandate.id);
        continue;
      }
      return refusalFor(error);
    }
    deps.log.info("checkout.decided", {
      attemptId: recorded.receipt.attempt.id,
      outcome: recorded.receipt.attempt.decision.outcome,
      ruleCode: recorded.receipt.attempt.decision.ruleCode,
    });
    const receipt = await pay(deps, recorded, snapshot);
    return { status: "decided", receipt, view: await viewOf(deps, receipt) };
  }
  return refuse("BUSY", "The owner's limits keep changing. Try again shortly.");
}

/** The write-ahead payment exists; now, and only now, PayPal is asked to move the money. */
async function pay(
  deps: AppDeps,
  recorded: RecordedAttempt,
  snapshot: OfferSnapshot | null,
): Promise<Receipt> {
  const { receipt, vaultId } = recorded;
  if (receipt.payment === null) {
    return receipt;
  }
  if (vaultId === null) {
    deps.log.error("checkout.no_vault_id", { attemptId: receipt.attempt.id });
    return receipt;
  }
  await sendOrder(deps, receipt.payment, {
    vaultId,
    description: orderDescription(receipt, snapshot?.title ?? null),
  });
  return (await deps.store.attempts.get(receipt.attempt.id)) ?? receipt;
}

function refusalFor(error: unknown): Refusal {
  if (error instanceof LeaseLostError) {
    return refuse("BUSY", "This checkout took too long and another one took over. Try again.");
  }
  if (error instanceof MandateNotActiveError) {
    return refuse("MANDATE_NOT_ACTIVE", "The owner revoked this agent's spending mandate.");
  }
  if (error instanceof ConflictError && error.code === "AGENT_REVOKED") {
    return refuse("UNAUTHENTICATED", "This agent's key was revoked.");
  }
  if (error instanceof ConflictError && error.code === "PAYMENT_IN_FLIGHT") {
    return refuse(
      "BUSY",
      "A payment for this product is still being confirmed. Try again shortly.",
    );
  }
  if (error instanceof PolicyChangedError) {
    return refuse("BUSY", "The owner's limits keep changing. Try again shortly.");
  }
  throw error;
}
