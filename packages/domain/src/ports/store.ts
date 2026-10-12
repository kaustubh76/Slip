import type { Attempt } from "../attempt.js";
import type { Hold } from "../hold.js";
import type { AgentId, AttemptId, MandateId, OwnerId, PolicyVersion, RequestId } from "../ids.js";
import type { Agent, AgentAuth, Mandate, Owner, PolicyLimits } from "../mandate.js";
import type { OfferSnapshot } from "../offer.js";
import type {
  Payment,
  PaymentEvent,
  PaymentIntent,
  PaymentPatch,
  PaymentStatus,
} from "../payment.js";
import type { Policy } from "../policy.js";
import type { Receipt } from "../receipt.js";
import type { AgentReport } from "../report.js";
import type { TransitionResult } from "../state-machine.js";

/**
 * Persistence port. Every method that must be atomic is a single method, so callers never hold
 * a transaction open across a network call and the in-memory fake can honour the same contract.
 * All record timestamps come from the caller's `now` (one clock, D22).
 *
 * Errors (from `@slip/domain`): `NotFoundError`, `ConflictError`, `InvariantError`,
 * `IllegalTransitionError`, `LeaseLostError`, `MandateNotActiveError`, `PolicyChangedError`,
 * `HoldAlreadyDecidedError`, `HoldExpiredError`, `HoldNotReadyError`.
 */
export interface Store {
  owners: OwnerRepo;
  mandates: MandateRepo;
  agents: AgentRepo;
  snapshots: SnapshotRepo;
  attempts: AttemptRepo;
  payments: PaymentRepo;
  holds: HoldRepo;
  webhooks: WebhookRepo;
  leases: LeaseRepo;
  reports: ReportRepo;
}

/** The result of a status move: see `classifyMove` for applied / unchanged / stale. */
export interface Transitioned<T> {
  value: T;
  result: TransitionResult;
}

/** Keyset pagination, newest first, ordered by (createdAt, id) so equal timestamps never skip. */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export interface PageRequest {
  limit: number;
  before?: Cursor;
}

export interface Page<T> {
  items: T[];
  next: Cursor | null;
}

export interface OwnerRepo {
  create(input: { id: OwnerId; email: string | null; now: Date }): Promise<Owner>;
  get(id: OwnerId): Promise<Owner | null>;
}

export interface MandateRepo {
  /** A PENDING mandate and its policy version 1, atomically. */
  create(input: {
    id: MandateId;
    ownerId: OwnerId;
    limits: PolicyLimits;
    now: Date;
  }): Promise<{ mandate: Mandate; policy: Policy }>;
  get(id: MandateId): Promise<Mandate | null>;
  findBySetupOrderId(orderId: string): Promise<Mandate | null>;
  /** For VAULT.PAYMENT-TOKEN.* webhooks; looks up a keyed hash, never the plaintext. */
  findByVaultId(vaultId: string): Promise<Mandate | null>;
  /** Set once, while PENDING. */
  attachSetupOrder(id: MandateId, orderId: string, now: Date): Promise<Mandate>;
  /** PENDING → ACTIVE with the vaulted payment method. Activating twice with the same vault id is `unchanged`. */
  activate(
    id: MandateId,
    vault: { vaultId: string; paypalCustomerId: string | null },
    now: Date,
  ): Promise<Transitioned<Mandate>>;
  /** The kill switch. Idempotent. */
  revoke(id: MandateId, now: Date): Promise<Transitioned<Mandate>>;
  /** The decrypted vault id, only while ACTIVE. The only way it leaves the store besides `record`. */
  vaultIdForCharge(id: MandateId): Promise<string | null>;
  /**
   * The decrypted vault id of a REVOKED mandate whose PayPal token is not yet confirmed deleted —
   * for deleting it at PayPal, never for charging. Null otherwise.
   */
  vaultIdForDeletion(id: MandateId): Promise<string | null>;
  /** Records PayPal's confirmation that the token is deleted. REVOKED only; a repeat is unchanged. */
  markVaultDeleted(id: MandateId, now: Date): Promise<Transitioned<Mandate>>;
  /** REVOKED mandates whose PayPal token still has to be deleted, oldest revoke first. */
  listAwaitingVaultDeletion(limit: number): Promise<Mandate[]>;
  currentPolicy(id: MandateId): Promise<Policy>;
  policy(id: MandateId, version: PolicyVersion): Promise<Policy | null>;
  /** Appends version current+1 with the changes applied. Refused once REVOKED. */
  updatePolicy(id: MandateId, changes: Partial<PolicyLimits>, now: Date): Promise<Policy>;
}

export interface AgentRepo {
  create(input: {
    id: AgentId;
    mandateId: MandateId;
    name: string;
    apiKeyHash: string;
    apiKeyPrefix: string;
    now: Date;
  }): Promise<Agent>;
  get(id: AgentId): Promise<Agent | null>;
  /** Null for an unknown or revoked key. The mandate is returned whatever its status. */
  authenticate(apiKeyHash: string): Promise<AgentAuth | null>;
  listByMandate(id: MandateId): Promise<Agent[]>;
  revoke(id: AgentId, now: Date): Promise<Transitioned<Agent>>;
}

export interface SnapshotRepo {
  /** Append-only; saving the same id twice is a `ConflictError`. */
  save(snapshot: OfferSnapshot, raw: unknown): Promise<void>;
  get(id: OfferSnapshot["id"]): Promise<OfferSnapshot | null>;
  /** The raw Channel3 response, for audit and replay. */
  getRaw(id: OfferSnapshot["id"]): Promise<{ raw: unknown } | null>;
  latestForProduct(productId: string): Promise<OfferSnapshot | null>;
}

export interface NewPayment {
  intent: PaymentIntent;
  /** PayPal-Request-Id for the order call. */
  requestId: RequestId;
}

export interface NewHold {
  expiresAt: Date;
}

export interface RecordAttemptInput {
  attempt: Attempt;
  /** Required for PAID (CAPTURE), optional for HELD (AUTHORIZE), forbidden for REJECTED. */
  payment: NewPayment | null;
  /** Required for HELD, forbidden otherwise. */
  hold: NewHold | null;
  /** Holder of the (agent, product) checkout lease; checked inside the same transaction. */
  leaseHolder: string;
}

export interface RecordedAttempt {
  receipt: Receipt;
  /** The decrypted vault id when a payment was initiated, read in the same transaction. */
  vaultId: string | null;
}

export interface AttemptRepo {
  /**
   * Writes the attempt, its INITIATED payment (with the ORDER request id) and its PENDING hold in
   * one transaction — after confirming, in that transaction, that the caller still holds the
   * checkout lease, the mandate is ACTIVE, and the attempt was checked under the current policy.
   * Nothing is written if any of that fails. Only the agent's own attempts: an OWNER_APPROVAL
   * follow-up is written by `holds.approveWithFollowUp`.
   */
  record(input: RecordAttemptInput): Promise<RecordedAttempt>;
  get(id: AttemptId): Promise<Receipt | null>;
  /** Every attempt by this agent for this product since `since`, newest first. */
  listRecent(agentId: AgentId, productId: string, since: Date): Promise<Receipt[]>;
  listByAgent(agentId: AgentId, page: PageRequest): Promise<Page<Receipt>>;
  listByMandate(mandateId: MandateId, page: PageRequest): Promise<Page<Receipt>>;
  /** The OWNER_APPROVAL follow-up of a HELD attempt, if one was made. */
  findChild(parentId: AttemptId): Promise<Receipt | null>;
}

export interface PaymentTransitionInput {
  patch?: PaymentPatch;
  /** Required when entering CAPTURING or VOIDING: the request id for that PayPal call. */
  operationRequestId?: RequestId;
  /** Free-form context stored with the payment event (PayPal status, webhook id, …). */
  detail?: unknown;
  now: Date;
}

export interface PaymentRepo {
  get(attemptId: AttemptId): Promise<Payment | null>;
  findByRequestId(requestId: RequestId): Promise<Payment | null>;
  findByPaypalOrderId(orderId: string): Promise<Payment | null>;
  /**
   * Compare-and-set status change plus a payment event, atomically. `stale` and `unchanged`
   * write no event (a patch may still fill empty PayPal ids on `unchanged`). A genuine
   * disagreement throws `IllegalTransitionError`.
   */
  transition(
    attemptId: AttemptId,
    to: PaymentStatus,
    input: PaymentTransitionInput,
  ): Promise<Transitioned<Payment>>;
  /** For the resolver: payments in these statuses with no change since `updatedBefore`. */
  listStale(
    statuses: readonly PaymentStatus[],
    updatedBefore: Date,
    limit: number,
  ): Promise<Payment[]>;
  events(attemptId: AttemptId): Promise<PaymentEvent[]>;
}

export interface HoldDecision {
  hold: Hold;
  payment: Payment | null;
  result: TransitionResult;
}

export interface HoldRepo {
  get(attemptId: AttemptId): Promise<Hold | null>;
  /**
   * Approves a hold that has a live authorization: PENDING → APPROVED before `expiresAt`, and the
   * payment AUTHORIZED → CAPTURING with this capture request id, in the same transaction. Needs
   * an ACTIVE mandate. A payment that is not AUTHORIZED yet is `HoldNotReadyError`. A hold with no
   * live authorization is approved with `approveWithFollowUp` instead.
   */
  approve(
    attemptId: AttemptId,
    input: { by: string; now: Date; captureRequestId: RequestId },
  ): Promise<HoldDecision>;
  /** PENDING → DECLINED; an AUTHORIZED payment moves to VOIDING with this request id. */
  decline(
    attemptId: AttemptId,
    input: { by: string; now: Date; voidRequestId: RequestId },
  ): Promise<HoldDecision>;
  /** PENDING → EXPIRED once `now ≥ expiresAt`; an AUTHORIZED payment moves to VOIDING. */
  expire(
    attemptId: AttemptId,
    input: { now: Date; voidRequestId: RequestId },
  ): Promise<HoldDecision>;
  listPending(mandateId: MandateId): Promise<Receipt[]>;
  /**
   * PENDING holds for this agent and product at any age, newest first. Checkout dedupe uses it:
   * a hold older than the dedupe window must still stop a second authorization.
   */
  listOpen(agentId: AgentId, productId: string): Promise<Receipt[]>;
  /** PENDING holds whose mandate is REVOKED — a revoke that stopped before declining them. */
  listPendingOnRevokedMandates(limit: number): Promise<Receipt[]>;
  listExpiring(now: Date, limit: number): Promise<Hold[]>;
  /**
   * Approves a hold that has no live authorization — none was placed, or PayPal failed or voided
   * it before any capture — and records the OWNER_APPROVAL attempt that pays in one step, in one
   * transaction: the hold becomes APPROVED only if the follow-up passes every `record` check
   * (lease, agent, ACTIVE mandate, current policy). A hold whose capture was attempted is never
   * followed up; that would charge again without asking.
   */
  approveWithFollowUp(input: {
    attemptId: AttemptId;
    by: string;
    followUp: RecordAttemptInput;
  }): Promise<{ hold: Hold; recorded: RecordedAttempt }>;
}

export interface WebhookEvent {
  /** PayPal's event id. */
  id: string;
  eventType: string;
  resourceId: string | null;
  payload: unknown;
  receivedAt: Date;
  processedAt: Date | null;
}

export interface WebhookRepo {
  /**
   * Stores a signature-verified event once. A redelivery returns `inserted: false` with the
   * stored `processedAt`; process it again while that is null.
   */
  recordOnce(
    event: Omit<WebhookEvent, "processedAt">,
  ): Promise<{ inserted: boolean; processedAt: Date | null }>;
  markProcessed(id: string, now: Date): Promise<void>;
  listUnprocessed(limit: number): Promise<WebhookEvent[]>;
}

export interface LeaseKey {
  agentId: AgentId;
  productId: string;
}

export interface LeaseRepo {
  /** True when free, expired, or already held by `holder` (then extended). */
  acquire(key: LeaseKey, holder: string, ttlMs: number, now: Date): Promise<boolean>;
  /** Releases only if `holder` still holds it. */
  release(key: LeaseKey, holder: string): Promise<void>;
}

export interface ReportRepo {
  agentReport(agentId: AgentId): Promise<AgentReport>;
}
