import { randomUUID } from "node:crypto";
import { decide, prepareCheck } from "@slip/check";
import {
  type AgentId,
  type Attempt,
  type AttemptId,
  agentId,
  attemptId,
  type ClassifierAnswer,
  DEFAULT_POLICY,
  type MandateId,
  mandateId,
  type Offer,
  type OfferSnapshot,
  type OwnerId,
  ownerId,
  type Policy,
  type RecordAttemptInput,
  type RecordedAttempt,
  type RequestId,
  requestId,
  type Store,
} from "@slip/domain";
import { NOW, offer, snapshot } from "@slip/domain/testing";

export { NOW, offer };

export const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);

export const newRequestId = (): RequestId => requestId(randomUUID());
export const newAttemptId = (): AttemptId => attemptId(randomUUID());
export const newProductId = (): string => `prod-${randomUUID().slice(0, 8)}`;

export interface World {
  ownerId: OwnerId;
  mandateId: MandateId;
  agentId: AgentId;
  vaultId: string;
  apiKeyHash: string;
}

/** An owner, a mandate (ACTIVE unless asked otherwise) and one agent. */
export async function world(store: Store, options: { activate?: boolean } = {}): Promise<World> {
  const owner = ownerId(randomUUID());
  const mandate = mandateId(randomUUID());
  const agent = agentId(randomUUID());
  const vaultId = `VAULT-${randomUUID()}`;
  const apiKeyHash = `hash-${randomUUID()}`;
  await store.owners.create({ id: owner, email: null, now: NOW });
  const { version: _version, ...limits } = DEFAULT_POLICY;
  await store.mandates.create({ id: mandate, ownerId: owner, limits, now: NOW });
  if (options.activate !== false) {
    await store.mandates.activate(mandate, { vaultId, paypalCustomerId: "CUST-1" }, NOW);
  }
  await store.agents.create({
    id: agent,
    mandateId: mandate,
    name: "test agent",
    apiKeyHash,
    apiKeyPrefix: "slip_te",
    now: NOW,
  });
  return { ownerId: owner, mandateId: mandate, agentId: agent, vaultId, apiKeyHash };
}

export interface DecideSpec {
  offers: Offer[];
  chosen: Offer;
  productId?: string;
  classifier?: ClassifierAnswer;
  now?: Date;
  policy?: Policy;
  id?: AttemptId;
  /** Saves the snapshot first (default). Set false to test the snapshot reference check. */
  saveSnapshot?: boolean;
}

/** Runs the real check on a stored snapshot and returns the attempt it produces. */
export async function decided(store: Store, w: World, spec: DecideSpec): Promise<Attempt> {
  const productId = spec.productId ?? newProductId();
  const now = spec.now ?? NOW;
  const policy = spec.policy ?? DEFAULT_POLICY;
  const snap: OfferSnapshot = snapshot({
    offers: spec.offers,
    productId,
    id: randomUUID(),
    fetchedAt: now,
  });
  if (spec.saveSnapshot !== false) {
    await store.snapshots.save(snap, { source: "test", productId });
  }
  const request = {
    agentId: w.agentId,
    productId,
    chosenOfferUrl: spec.chosen.url,
    reason: "cheapest I found",
  };
  const prepared = prepareCheck({ snapshot: snap, request, policy, now });
  const decision =
    prepared.kind === "ready"
      ? decide(prepared, policy, spec.classifier ?? { instruction_like: false })
      : prepared.decision;
  return {
    id: spec.id ?? newAttemptId(),
    agentId: w.agentId,
    mandateId: w.mandateId,
    productId,
    origin: "AGENT",
    parentAttemptId: null,
    chosenOfferUrl: spec.chosen.url,
    selectedOptions: null,
    reason: request.reason,
    decision,
    createdAt: now,
  };
}

/** Market shapes that produce each outcome through the real check. */
export const markets = {
  /** Chosen is the cheapest → PAID / R7. */
  paid: () => {
    const chosen = offer({ price: 47.99 });
    return { offers: [chosen, offer({ price: 54.99 })], chosen };
  },
  /** 12 % and $15 over → REJECTED / R4. */
  overpaid: () => {
    const chosen = offer({ price: 140 });
    return { offers: [offer({ price: 125 }), chosen], chosen };
  },
  /** $250 within 0.4 % of the best → HELD / R6 (above the $200 cap). */
  aboveCap: () => {
    const chosen = offer({ price: 250 });
    return { offers: [offer({ price: 249 }), chosen], chosen };
  },
  /** 3 % over and the pricier store pays more commission → HELD / R5. */
  conflict: () => {
    const chosen = offer({ price: 103, rate: 0.08 });
    return { offers: [offer({ price: 100, rate: 0.02 }), chosen], chosen };
  },
};

export interface RecordSpec {
  /** Overrides the default payment for the outcome; null for none. */
  payment?: { intent: "CAPTURE" | "AUTHORIZE"; requestId?: RequestId } | null;
  /** HELD only: false for a hold with no PayPal order. */
  withOrder?: boolean;
  holdExpiresAt?: Date;
  /** Skip taking the lease (to test fencing). */
  holder?: string;
  takeLease?: boolean;
}

/** Takes the checkout lease and records the attempt with the payment/hold its outcome calls for. */
export async function record(
  store: Store,
  attempt: Attempt,
  spec: RecordSpec = {},
): Promise<RecordedAttempt> {
  const holder = spec.holder ?? `holder-${randomUUID()}`;
  if (spec.takeLease !== false) {
    const ok = await store.leases.acquire(
      { agentId: attempt.agentId, productId: attempt.productId },
      holder,
      60_000,
      attempt.createdAt,
    );
    if (!ok) {
      throw new Error("test setup: lease not acquired");
    }
  }
  // Released afterwards, as the orchestrator does once the checkout is finished.
  try {
    return await store.attempts.record(recordInput(attempt, holder, spec));
  } finally {
    if (spec.takeLease !== false) {
      await store.leases.release(
        { agentId: attempt.agentId, productId: attempt.productId },
        holder,
      );
    }
  }
}

export function recordInput(
  attempt: Attempt,
  holder: string,
  spec: RecordSpec = {},
): RecordAttemptInput {
  const outcome = attempt.decision.outcome;
  let payment: RecordAttemptInput["payment"] = null;
  if (spec.payment !== undefined) {
    payment =
      spec.payment === null
        ? null
        : { intent: spec.payment.intent, requestId: spec.payment.requestId ?? newRequestId() };
  } else if (outcome === "PAID") {
    payment = { intent: "CAPTURE", requestId: newRequestId() };
  } else if (outcome === "HELD" && spec.withOrder !== false) {
    payment = { intent: "AUTHORIZE", requestId: newRequestId() };
  }
  const hold =
    outcome === "HELD"
      ? { expiresAt: spec.holdExpiresAt ?? new Date(attempt.createdAt.getTime() + 48 * 3_600_000) }
      : null;
  return { attempt, payment, hold, leaseHolder: holder };
}

/** Moves a HELD attempt's payment to AUTHORIZED, as PayPal's order response would. */
export async function authorize(store: Store, id: AttemptId, now = at(1)) {
  return store.payments.transition(id, "AUTHORIZED", {
    patch: { paypalOrderId: `ORDER-${id}`, authorizationId: `AUTH-${id}` },
    now,
  });
}

/** Moves a PAID attempt's payment to CAPTURED. */
export async function capture(store: Store, id: AttemptId, now = at(1)) {
  return store.payments.transition(id, "CAPTURED", {
    patch: { paypalOrderId: `ORDER-${id}`, captureId: `CAP-${id}` },
    now,
  });
}
