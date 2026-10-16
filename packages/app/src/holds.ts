import {
  approvalPath,
  attemptId,
  type Cents,
  type CheckoutRequest,
  ConflictError,
  type Decision,
  HoldAlreadyDecidedError,
  HoldExpiredError,
  HoldNotReadyError,
  InvalidIdError,
  LeaseLostError,
  MandateNotActiveError,
  type OwnerId,
  type Payment,
  PolicyChangedError,
  type Receipt,
  type RecordAttemptInput,
  type RuleCode,
  requestId,
} from "@slip/domain";
import type { ReceiptView } from "@slip/receipt";
import { checkOffers, currentSnapshot } from "./checkout/decision.js";
import type { AppDeps } from "./deps.js";
import { orderDescription, sendCapture, sendOrder, sendVoid } from "./payments.js";
import { viewOf } from "./views.js";

/**
 * The owner's side of a HELD attempt: see what approving would charge, approve, or decline. Every
 * call is scoped to the owner — a hold on someone else's mandate is "not found", never "forbidden".
 *
 * A hold with a live authorization is approved by capturing exactly what was reserved. A hold with
 * none (Channel3 was down, or PayPal failed or voided the authorization before any capture) is
 * checked again on current prices and paid in one step by a follow-up attempt, but only at the
 * price the owner was shown; the approval and the follow-up are written together (D27).
 */

export type HoldRefusalReason =
  | "NOT_FOUND"
  | "ALREADY_DECIDED"
  | "EXPIRED"
  | "NOT_READY"
  | "MANDATE_NOT_ACTIVE"
  | "AGENT_REVOKED"
  | "PRICE_CHANGED"
  | "PRICES_UNAVAILABLE"
  | "RECHECK_REJECTED"
  | "BUSY";

/** Nothing was written. */
export interface HoldRefusal {
  status: "refused";
  reason: HoldRefusalReason;
  message: string;
  /** PRICE_CHANGED: what approving would charge now. */
  amountCents?: Cents;
  /** RECHECK_REJECTED: the rule that rejects the purchase now. */
  ruleCode?: RuleCode;
}

export interface Shown {
  receipt: Receipt;
  view: ReceiptView;
}

export interface HoldDecided extends Shown {
  status: "done";
  /** The OWNER_APPROVAL attempt that pays for an approved hold that had no live authorization. */
  followUp: Shown | null;
}

export type HoldResult = HoldDecided | HoldRefusal;

export interface ApprovalPreview extends Shown {
  status: "preview";
  /**
   * `capture`: approving collects the money already reserved. `pay`: nothing is reserved, so
   * approving checks again and pays in one step.
   */
  kind: "capture" | "pay";
  /** What approving charges. Pass it back to `approveHold` as `expectedAmountCents`. */
  amountCents: Cents;
  merchant: string;
}

const refuse = (
  reason: HoldRefusalReason,
  message: string,
  extra: { amountCents?: Cents; ruleCode?: RuleCode } = {},
): HoldRefusal => ({ status: "refused", reason, message, ...extra });

const NOT_FOUND = (): HoldRefusal => refuse("NOT_FOUND", "There is no such hold.");
const NOT_READY = (): HoldRefusal =>
  refuse("NOT_READY", "PayPal has not confirmed the reservation yet. Try again in a minute.");

type Approvable =
  | { kind: "approved"; receipt: Receipt }
  | { kind: "capture"; receipt: Receipt; payment: Payment }
  | { kind: "pay"; receipt: Receipt };

/** The owner's hold, and what approving it takes — or why it cannot be approved. */
async function approvable(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
): Promise<Approvable | HoldRefusal> {
  const owned = await ownedReceipt(deps, ownerId, id);
  const hold = owned?.receipt.hold;
  if (owned === null || hold == null) {
    return NOT_FOUND();
  }
  const { receipt } = owned;
  switch (hold.status) {
    case "APPROVED":
      return { kind: "approved", receipt };
    case "DECLINED":
      return refuse("ALREADY_DECIDED", "This hold was declined.");
    case "EXPIRED":
      return refuse("EXPIRED", "This hold expired and its reservation was released.");
    case "PENDING":
      break;
  }
  if (deps.clock.now().getTime() >= hold.expiresAt.getTime()) {
    return refuse("EXPIRED", "This hold expired; its reservation is being released.");
  }
  if (!owned.mandateActive) {
    return refuse("MANDATE_NOT_ACTIVE", "This mandate is revoked, so nothing can be paid.");
  }
  const { payment } = receipt;
  switch (approvalPath(payment)) {
    case "capture":
      return payment === null ? NOT_READY() : { kind: "capture", receipt, payment };
    case "pay":
      return { kind: "pay", receipt };
    case "not-ready":
    case "spent":
      return NOT_READY();
  }
}

/** The receipt, only if its mandate belongs to this owner; anything else (or a malformed id) is null. */
export async function ownedReceipt(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
): Promise<{ receipt: Receipt; mandateActive: boolean } | null> {
  let receipt: Receipt | null;
  try {
    receipt = await deps.store.attempts.get(attemptId(id));
  } catch (error) {
    if (error instanceof InvalidIdError) {
      return null;
    }
    throw error;
  }
  if (receipt === null) {
    return null;
  }
  const mandate = await deps.store.mandates.get(receipt.attempt.mandateId);
  return mandate?.ownerId === ownerId
    ? { receipt, mandateActive: mandate.status === "ACTIVE" }
    : null;
}

type Recheck =
  | { ok: true; decision: Decision; amountCents: Cents; merchant: string; title: string | null }
  | { ok: false; refusal: HoldRefusal };

/**
 * The held purchase checked again on current prices under the current policy. The owner's
 * approval overrides a hold, never a rejection; and there must be a fresh USD price to pay.
 */
async function recheck(deps: AppDeps, held: Receipt): Promise<Recheck> {
  const a = held.attempt;
  const request: CheckoutRequest = {
    agentId: a.agentId,
    productId: a.productId,
    chosenOfferUrl: a.chosenOfferUrl,
    ...(a.selectedOptions === null ? {} : { selectedOptions: a.selectedOptions }),
    reason: a.reason,
  };
  const policy = await deps.store.mandates.currentPolicy(a.mandateId);
  const now = deps.clock.now();
  const { snapshot } = await currentSnapshot(deps, request, policy, now);
  const { decision } = await checkOffers(deps, { request, policy, snapshot, now });
  if (decision.outcome === "REJECTED") {
    return {
      ok: false,
      refusal: refuse(
        "RECHECK_REJECTED",
        "Checked again on current prices, Slip would now reject this purchase, so it cannot be approved.",
        { ruleCode: decision.ruleCode },
      ),
    };
  }
  const chosen = decision.checkResult.chosen;
  if (chosen?.priceCents == null || chosen.currency !== "USD") {
    return {
      ok: false,
      refusal: refuse(
        "PRICES_UNAVAILABLE",
        "Slip cannot get a current US-dollar price for this item. Try again later.",
      ),
    };
  }
  return {
    ok: true,
    decision,
    amountCents: chosen.priceCents,
    merchant: chosen.domain,
    title: snapshot?.title ?? null,
  };
}

/**
 * What approving would charge, and how. Changes nothing except, for a hold with nothing reserved,
 * the price cache: that kind is checked again on current prices.
 */
export async function previewApproval(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
): Promise<ApprovalPreview | HoldRefusal> {
  const found = await approvable(deps, ownerId, id);
  if ("status" in found) {
    return found;
  }
  if (found.kind === "approved") {
    return refuse("ALREADY_DECIDED", "This hold was already approved.");
  }
  const { receipt } = found;
  const shown = { status: "preview" as const, receipt, view: await viewOf(deps, receipt) };
  if (found.kind === "capture") {
    return {
      ...shown,
      kind: "capture",
      amountCents: found.payment.amountCents,
      merchant: receipt.attempt.decision.checkResult.chosen?.domain ?? "",
    };
  }
  const checked = await recheck(deps, receipt);
  if (!checked.ok) {
    return checked.refusal;
  }
  return { ...shown, kind: "pay", amountCents: checked.amountCents, merchant: checked.merchant };
}

/**
 * The owner approves a hold, at the amount the preview showed. A repeat (a double click) reports
 * where things stand and starts nothing new. Every refusal leaves the hold PENDING.
 */
export async function approveHold(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
  input: { expectedAmountCents: Cents },
): Promise<HoldResult> {
  const found = await approvable(deps, ownerId, id);
  if ("status" in found) {
    return found;
  }
  switch (found.kind) {
    case "approved":
      return decided(deps, found.receipt);
    case "capture":
      return approveByCapture(deps, ownerId, found, input.expectedAmountCents);
    case "pay":
      return approveByFollowUp(deps, ownerId, found.receipt, input.expectedAmountCents);
  }
}

/** Approves and starts the capture in one transaction, then collects the money. */
async function approveByCapture(
  deps: AppDeps,
  ownerId: OwnerId,
  held: { receipt: Receipt; payment: Payment },
  expectedAmountCents: Cents,
): Promise<HoldResult> {
  if (held.payment.amountCents !== expectedAmountCents) {
    return refuse(
      "PRICE_CHANGED",
      "The reserved amount is not the one you approved. Review it and approve again.",
      { amountCents: held.payment.amountCents },
    );
  }
  const id = held.receipt.attempt.id;
  let approval: Awaited<ReturnType<AppDeps["store"]["holds"]["approve"]>>;
  try {
    approval = await deps.store.holds.approve(id, {
      by: ownerId,
      now: deps.clock.now(),
      captureRequestId: requestId(deps.ids.uuid()),
    });
  } catch (error) {
    return refusalFor(error);
  }
  // Only the call that moved the hold captures; a concurrent repeat sees `unchanged`.
  if (approval.result === "applied" && approval.payment?.status === "CAPTURING") {
    deps.log.info("hold.approved", { attemptId: id, paidBy: "capture" });
    await sendCapture(deps, approval.payment);
  }
  return decided(deps, held.receipt);
}

/**
 * Checks again under the (agent, product) lease, so no agent checkout interleaves; refuses unless
 * the price is the one the owner saw; then approves and records the paying follow-up together,
 * and only then asks PayPal for a one-step order.
 */
async function approveByFollowUp(
  deps: AppDeps,
  ownerId: OwnerId,
  held: Receipt,
  expectedAmountCents: Cents,
): Promise<HoldResult> {
  const parent = held.attempt;
  const holder = deps.ids.uuid();
  const key = { agentId: parent.agentId, productId: parent.productId };
  if (!(await deps.store.leases.acquire(key, holder, deps.config.leaseTtlMs, deps.clock.now()))) {
    return refuse("BUSY", "A checkout for this item is in progress. Try again shortly.");
  }
  try {
    const checked = await recheck(deps, held);
    if (!checked.ok) {
      return checked.refusal;
    }
    if (checked.amountCents !== expectedAmountCents) {
      return refuse(
        "PRICE_CHANGED",
        "The price changed since you looked. Review the new amount and approve again.",
        { amountCents: checked.amountCents },
      );
    }
    let approval: Awaited<ReturnType<AppDeps["store"]["holds"]["approveWithFollowUp"]>>;
    try {
      approval = await deps.store.holds.approveWithFollowUp({
        attemptId: parent.id,
        by: ownerId,
        followUp: followUpInput(deps, held, checked.decision, holder),
      });
    } catch (error) {
      return refusalFor(error);
    }
    const { receipt: child, vaultId } = approval.recorded;
    deps.log.info("hold.approved", {
      attemptId: parent.id,
      paidBy: "follow-up",
      followUp: child.attempt.id,
    });
    if (child.payment !== null && vaultId !== null) {
      await sendOrder(deps, child.payment, {
        vaultId,
        description: orderDescription(child, checked.title),
      });
    } else {
      deps.log.error("hold.no_vault_id", { attemptId: child.attempt.id });
    }
    return decided(deps, held);
  } finally {
    await deps.store.leases.release(key, holder);
  }
}

/** The OWNER_APPROVAL attempt: the re-check's findings, decided by the owner, paid in one step. */
function followUpInput(
  deps: AppDeps,
  held: Receipt,
  recheck: Decision,
  leaseHolder: string,
): RecordAttemptInput {
  const parent = held.attempt;
  const { checkResult } = recheck;
  return {
    attempt: {
      id: attemptId(deps.ids.uuid()),
      agentId: parent.agentId,
      mandateId: parent.mandateId,
      productId: parent.productId,
      origin: "OWNER_APPROVAL",
      parentAttemptId: parent.id,
      chosenOfferUrl: parent.chosenOfferUrl,
      selectedOptions: parent.selectedOptions,
      reason: parent.reason,
      decision: {
        outcome: "PAID",
        ruleCode: "OWNER_APPROVED",
        checkResult: {
          ...checkResult,
          ruleCode: "OWNER_APPROVED",
          ruleCodes: ["OWNER_APPROVED", ...checkResult.ruleCodes],
        },
      },
      createdAt: deps.clock.now(),
    },
    payment: { intent: "CAPTURE", requestId: requestId(deps.ids.uuid()) },
    hold: null,
    leaseHolder,
  };
}

/** The owner declines: the hold closes and a confirmed reservation is released. */
export async function declineHold(
  deps: AppDeps,
  ownerId: OwnerId,
  id: string,
): Promise<HoldResult> {
  const owned = await ownedReceipt(deps, ownerId, id);
  if (owned?.receipt.hold == null) {
    return NOT_FOUND();
  }
  return closeHold(deps, owned.receipt, ownerId);
}

/**
 * Declines a hold for `by` — its owner, or the system finishing a revoke — and voids a confirmed
 * authorization. Allowed on a revoked mandate: it releases money. An unconfirmed authorization is
 * voided by the resolver once PayPal confirms it. Declining twice is a no-op.
 */
export async function closeHold(deps: AppDeps, held: Receipt, by: string): Promise<HoldResult> {
  let decline: Awaited<ReturnType<AppDeps["store"]["holds"]["decline"]>>;
  try {
    decline = await deps.store.holds.decline(held.attempt.id, {
      by,
      now: deps.clock.now(),
      voidRequestId: requestId(deps.ids.uuid()),
    });
  } catch (error) {
    return refusalFor(error);
  }
  if (decline.result === "applied") {
    deps.log.info("hold.declined", { attemptId: held.attempt.id, by });
    if (decline.payment?.status === "VOIDING") {
      await sendVoid(deps, decline.payment);
    }
  }
  return decided(deps, held);
}

/** The hold as it stands now, with its follow-up if one was made. */
async function decided(deps: AppDeps, held: Receipt): Promise<HoldDecided> {
  const receipt = (await deps.store.attempts.get(held.attempt.id)) ?? held;
  const child = await deps.store.attempts.findChild(receipt.attempt.id);
  return {
    status: "done",
    receipt,
    view: await viewOf(deps, receipt, { child }),
    followUp: child === null ? null : { receipt: child, view: await viewOf(deps, child) },
  };
}

function refusalFor(error: unknown): HoldRefusal {
  if (error instanceof HoldAlreadyDecidedError) {
    return refuse("ALREADY_DECIDED", "This hold was already decided.");
  }
  if (error instanceof HoldExpiredError) {
    return refuse("EXPIRED", "This hold expired; its reservation is being released.");
  }
  if (error instanceof HoldNotReadyError) {
    return NOT_READY();
  }
  if (error instanceof MandateNotActiveError) {
    return refuse("MANDATE_NOT_ACTIVE", "This mandate is revoked, so nothing can be paid.");
  }
  if (error instanceof ConflictError && error.code === "AGENT_REVOKED") {
    return refuse("AGENT_REVOKED", "This agent's key was revoked, so nothing is paid for it.");
  }
  if (error instanceof ConflictError && error.code === "CHILD_ATTEMPT_EXISTS") {
    return refuse("ALREADY_DECIDED", "This hold was already approved.");
  }
  if (
    error instanceof LeaseLostError ||
    error instanceof PolicyChangedError ||
    (error instanceof ConflictError && error.code === "PAYMENT_IN_FLIGHT")
  ) {
    return refuse("BUSY", "Something changed while approving. Try again.");
  }
  throw error;
}
