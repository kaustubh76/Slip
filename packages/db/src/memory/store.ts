import {
  type Agent,
  type AgentReport,
  type Attempt,
  assertDirectRecord,
  assertRecordInvariants,
  ConflictError,
  classifyMove,
  type Hold,
  type HoldAction,
  type HoldDecision,
  IN_FLIGHT_PAYMENT_STATUSES,
  InvariantError,
  initialHold,
  initialPayment,
  initialPaymentEvent,
  LeaseLostError,
  leaseKeyString,
  lowerMedian,
  MANDATE_TRANSITIONS,
  type Mandate,
  MandateNotActiveError,
  NotFoundError,
  type OfferSnapshot,
  OfferSnapshotSchema,
  type Owner,
  type Page,
  type PageRequest,
  type Payment,
  type PaymentEvent,
  type PaymentPlan,
  type Policy,
  PolicyChangedError,
  PolicySchema,
  parseStoredCheckResult,
  planApprovalWithFollowUp,
  planHoldDecision,
  planPaymentTransition,
  type Receipt,
  type RecordAttemptInput,
  type RecordedAttempt,
  SelectedOptionSchema,
  type Store,
  type WebhookEvent,
} from "@slip/domain";
import { z } from "zod";
import { Conflict, MAX_PAGE_SIZE } from "../codes.js";

/**
 * In-memory `Store` for the orchestrator's tests and the benchmark replay. It runs the same pure
 * planners as the Postgres store and enforces the same uniqueness and reference rules with the
 * same error codes; the shared contract suite holds it to that.
 *
 * Fidelity details that matter:
 * - Every read returns a fresh copy, so callers cannot mutate stored state.
 * - JSON columns go through JSON and back (dates become strings and are revived by the domain
 *   schemas), exactly as jsonb does in Postgres.
 * - Each method checks everything before changing anything, so a refused write leaves no trace —
 *   the transaction rollback of the Postgres store.
 */

const SelectedOptionsSchema = z.array(SelectedOptionSchema).nullable();

const jsonRoundTrip = <T>(value: T): unknown => JSON.parse(JSON.stringify(value ?? null));

const copy = <T>(value: T): T => structuredClone(value);

interface MandateRecord {
  mandate: Mandate;
  vaultId: string | null;
}

interface AgentRecord {
  agent: Agent;
  apiKeyHash: string;
}

/** An attempt stored the way Postgres stores it: columns plus a JSON check result. */
interface AttemptRecord {
  attempt: Omit<Attempt, "decision" | "selectedOptions">;
  selectedOptions: unknown;
  outcome: Attempt["decision"]["outcome"];
  ruleCode: Attempt["decision"]["ruleCode"];
  checkResultJson: unknown;
}

interface SnapshotRecord {
  json: unknown;
  raw: unknown;
  productId: string;
  fetchedAt: Date;
  id: string;
}

export function createMemoryStore(): Store {
  const owners = new Map<string, Owner>();
  const mandates = new Map<string, MandateRecord>();
  const policies = new Map<string, Policy[]>();
  const agents = new Map<string, AgentRecord>();
  const snapshots = new Map<string, SnapshotRecord>();
  const attempts = new Map<string, AttemptRecord>();
  const payments = new Map<string, Payment>();
  const events = new Map<string, PaymentEvent[]>();
  const holds = new Map<string, Hold>();
  const webhooks = new Map<string, WebhookEvent>();
  const leases = new Map<string, { holder: string; expiresAt: Date }>();

  // ---------- helpers ----------

  const mandateOrThrow = (id: string): MandateRecord => {
    const record = mandates.get(id);
    if (record === undefined) {
      throw new NotFoundError("mandate", id);
    }
    return record;
  };

  const latestPolicy = (mandateId: string): Policy | undefined => policies.get(mandateId)?.at(-1);

  const toAttempt = (record: AttemptRecord): Attempt => ({
    ...copy(record.attempt),
    selectedOptions: SelectedOptionsSchema.parse(copy(record.selectedOptions)),
    decision: {
      outcome: record.outcome,
      ruleCode: record.ruleCode,
      checkResult: parseStoredCheckResult(1, copy(record.checkResultJson)),
    },
  });

  const receiptOf = (record: AttemptRecord): Receipt => {
    const id = record.attempt.id;
    const payment = payments.get(id);
    const hold = holds.get(id);
    return {
      attempt: toAttempt(record),
      payment: payment === undefined ? null : copy(payment),
      hold: hold === undefined ? null : copy(hold),
    };
  };

  /** Newest first, ties broken by id descending — the Postgres index order. */
  const newestFirst = (a: AttemptRecord, b: AttemptRecord): number =>
    b.attempt.createdAt.getTime() - a.attempt.createdAt.getTime() ||
    (b.attempt.id < a.attempt.id ? -1 : b.attempt.id > a.attempt.id ? 1 : 0);

  const pageOf = (filter: (r: AttemptRecord) => boolean, request: PageRequest): Page<Receipt> => {
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > MAX_PAGE_SIZE) {
      throw new InvariantError(`page limit must be 1..${MAX_PAGE_SIZE}, got ${request.limit}`);
    }
    const before = request.before;
    const rows = [...attempts.values()]
      .filter(filter)
      .filter(
        (r) =>
          before === undefined ||
          r.attempt.createdAt.getTime() < before.createdAt.getTime() ||
          (r.attempt.createdAt.getTime() === before.createdAt.getTime() &&
            r.attempt.id < before.id),
      )
      .sort(newestFirst);
    const items = rows.slice(0, request.limit).map(receiptOf);
    const last = items.at(-1);
    return {
      items,
      next:
        rows.length > request.limit && last !== undefined
          ? { createdAt: last.attempt.createdAt, id: last.attempt.id }
          : null,
    };
  };

  /** The unique constraints Postgres checks when a payment row is written. */
  const assertPaymentUnique = (next: Payment): void => {
    for (const other of payments.values()) {
      if (other.attemptId === next.attemptId) {
        continue;
      }
      if (
        IN_FLIGHT_PAYMENT_STATUSES.includes(next.status) &&
        IN_FLIGHT_PAYMENT_STATUSES.includes(other.status) &&
        other.agentId === next.agentId &&
        other.productId === next.productId
      ) {
        throw new ConflictError(
          Conflict.PAYMENT_IN_FLIGHT,
          "another payment for this agent and product is in flight",
        );
      }
      for (const key of ["paypalOrderId", "authorizationId", "captureId"] as const) {
        if (next[key] !== null && other[key] === next[key]) {
          throw new ConflictError(
            Conflict.PAYPAL_ID_IN_USE,
            `${key} ${next[key]} belongs to another payment`,
          );
        }
      }
    }
  };

  const requestIdInUse = (requestId: string): boolean =>
    [...payments.values()].some((p) => p.operations.some((op) => op.requestId === requestId));

  const commitPaymentPlan = (plan: PaymentPlan): void => {
    if (!plan.changed) {
      return;
    }
    assertPaymentUnique(plan.payment);
    if (plan.operation !== null && requestIdInUse(plan.operation.requestId)) {
      throw new ConflictError(Conflict.REQUEST_ID_IN_USE, "request id already used");
    }
    payments.set(plan.payment.attemptId, copy(plan.payment));
    if (plan.event !== null) {
      const list = events.get(plan.event.attemptId) ?? [];
      list.push({ ...plan.event, detail: jsonRoundTrip(plan.event.detail) });
      events.set(plan.event.attemptId, list);
    }
  };

  const decideHold = (attemptId: string, action: HoldAction): HoldDecision => {
    const hold = holds.get(attemptId);
    if (hold === undefined) {
      throw new NotFoundError("hold", attemptId);
    }
    const payment = payments.get(attemptId) ?? null;
    const plan = planHoldDecision(copy(hold), payment === null ? null : copy(payment), action);
    if (action.kind === "approve" && plan.result === "applied") {
      // The kill switch: no approval moves money once the mandate is revoked.
      const mandateId = attempts.get(attemptId)?.attempt.mandateId;
      const mandate = mandateId === undefined ? undefined : mandates.get(mandateId);
      if (mandate === undefined) {
        throw new NotFoundError("attempt", attemptId);
      }
      if (mandate.mandate.status !== "ACTIVE") {
        throw new MandateNotActiveError(mandate.mandate.id, mandate.mandate.status);
      }
    }
    if (plan.paymentPlan?.changed) {
      // Validate the payment write before touching the hold, as one transaction would.
      assertPaymentUnique(plan.paymentPlan.payment);
      const op = plan.paymentPlan.operation;
      if (op !== null && requestIdInUse(op.requestId)) {
        throw new ConflictError(Conflict.REQUEST_ID_IN_USE, "request id already used");
      }
    }
    if (plan.result === "applied") {
      holds.set(attemptId, copy(plan.hold));
    }
    if (plan.paymentPlan !== null) {
      commitPaymentPlan(plan.paymentPlan);
    }
    const stored = payments.get(attemptId);
    return {
      hold: copy(holds.get(attemptId) as Hold),
      payment: stored === undefined ? null : copy(stored),
      result: plan.result,
    };
  };

  /**
   * The checks and writes of `attempts.record`. Everything is checked before anything changes, so
   * a refusal leaves no trace — and `holds.approveWithFollowUp` can call it before approving.
   */
  const recordChecked = (input: RecordAttemptInput): RecordedAttempt => {
    assertRecordInvariants(input);
    const { attempt } = input;
    const payment = initialPayment(input);
    const hold = initialHold(input);
    const now = attempt.createdAt;
    const key = { agentId: attempt.agentId, productId: attempt.productId };

    const lease = leases.get(leaseKeyString(key));
    if (
      lease === undefined ||
      lease.holder !== input.leaseHolder ||
      lease.expiresAt.getTime() <= now.getTime()
    ) {
      throw new LeaseLostError(leaseKeyString(key));
    }

    const agent = agents.get(attempt.agentId);
    if (agent === undefined) {
      throw new NotFoundError("agent", attempt.agentId);
    }
    if (agent.agent.mandateId !== attempt.mandateId) {
      throw new InvariantError(
        `agent ${attempt.agentId} does not act under mandate ${attempt.mandateId}`,
      );
    }
    if (agent.agent.revokedAt !== null) {
      throw new ConflictError(Conflict.AGENT_REVOKED, `agent ${attempt.agentId} is revoked`);
    }

    const mandate = mandates.get(attempt.mandateId);
    if (mandate === undefined) {
      throw new NotFoundError("mandate", attempt.mandateId);
    }
    if (mandate.mandate.status !== "ACTIVE") {
      throw new MandateNotActiveError(mandate.mandate.id, mandate.mandate.status);
    }
    const checked = attempt.decision.checkResult.policyVersion;
    const current = latestPolicy(attempt.mandateId);
    if (current === undefined || current.version !== checked) {
      throw new PolicyChangedError(checked, current?.version ?? 0);
    }

    // Constraints, in the order Postgres meets them: unique indexes during the insert,
    // foreign keys at the end of the statement.
    if (attempts.has(attempt.id)) {
      throw new ConflictError(Conflict.ATTEMPT_EXISTS, `attempt ${attempt.id} exists`);
    }
    if (
      attempt.parentAttemptId !== null &&
      [...attempts.values()].some((r) => r.attempt.parentAttemptId === attempt.parentAttemptId)
    ) {
      throw new ConflictError(
        Conflict.CHILD_ATTEMPT_EXISTS,
        "the hold already has a follow-up attempt",
      );
    }
    const snapshotRef = attempt.decision.checkResult.snapshotId;
    if (snapshotRef !== null && !snapshots.has(snapshotRef)) {
      throw new InvariantError(`snapshot ${snapshotRef} does not exist`);
    }
    if (payment !== null) {
      assertPaymentUnique(payment);
      for (const op of payment.operations) {
        if (requestIdInUse(op.requestId)) {
          throw new ConflictError(Conflict.REQUEST_ID_IN_USE, "request id already used");
        }
      }
    }

    const { decision, selectedOptions, ...rest } = attempt;
    const record: AttemptRecord = {
      attempt: copy(rest),
      selectedOptions: jsonRoundTrip(selectedOptions),
      outcome: decision.outcome,
      ruleCode: decision.ruleCode,
      checkResultJson: jsonRoundTrip(decision.checkResult),
    };
    attempts.set(attempt.id, record);
    if (payment !== null) {
      payments.set(payment.attemptId, copy(payment));
      const event = initialPaymentEvent(payment);
      events.set(payment.attemptId, [{ ...event, detail: jsonRoundTrip(event.detail) }]);
    }
    if (hold !== null) {
      holds.set(hold.attemptId, copy(hold));
    }
    return {
      receipt: receiptOf(record),
      vaultId: payment !== null ? mandate.vaultId : null,
    };
  };

  // ---------- repositories ----------

  return {
    owners: {
      async create(input) {
        if (owners.has(input.id)) {
          throw new ConflictError(Conflict.OWNER_EXISTS, `owner ${input.id} exists`);
        }
        if (input.email !== null && [...owners.values()].some((o) => o.email === input.email)) {
          throw new ConflictError(Conflict.EMAIL_IN_USE, "email in use");
        }
        const owner: Owner = { id: input.id, email: input.email, createdAt: input.now };
        owners.set(owner.id, copy(owner));
        return copy(owner);
      },
      async get(id) {
        const owner = owners.get(id);
        return owner === undefined ? null : copy(owner);
      },
    },

    mandates: {
      async create(input) {
        if (!owners.has(input.ownerId)) {
          throw new InvariantError(`owner ${input.ownerId} does not exist`);
        }
        if (mandates.has(input.id)) {
          throw new ConflictError(Conflict.MANDATE_EXISTS, `mandate ${input.id} exists`);
        }
        const policy = PolicySchema.safeParse({ ...input.limits, version: 1 });
        if (!policy.success) {
          throw new InvariantError(`invalid policy: ${policy.error.message}`);
        }
        const mandate: Mandate = {
          id: input.id,
          ownerId: input.ownerId,
          status: "PENDING",
          setupOrderId: null,
          paypalCustomerId: null,
          hasVaultId: false,
          createdAt: input.now,
          activatedAt: null,
          revokedAt: null,
          vaultDeletedAt: null,
        };
        mandates.set(mandate.id, { mandate: copy(mandate), vaultId: null });
        policies.set(mandate.id, [copy(policy.data)]);
        return { mandate: copy(mandate), policy: copy(policy.data) };
      },

      async get(id) {
        const record = mandates.get(id);
        return record === undefined ? null : copy(record.mandate);
      },

      async findBySetupOrderId(orderId) {
        const record = [...mandates.values()].find((r) => r.mandate.setupOrderId === orderId);
        return record === undefined ? null : copy(record.mandate);
      },

      async findByVaultId(vaultId) {
        const record = [...mandates.values()].find((r) => r.vaultId === vaultId);
        return record === undefined ? null : copy(record.mandate);
      },

      async attachSetupOrder(id, orderId) {
        const record = mandateOrThrow(id);
        const { mandate } = record;
        if (mandate.setupOrderId === orderId) {
          return copy(mandate);
        }
        if (mandate.status !== "PENDING") {
          throw new ConflictError(
            Conflict.MANDATE_NOT_PENDING,
            `mandate ${id} is ${mandate.status}`,
          );
        }
        if (mandate.setupOrderId !== null) {
          throw new ConflictError(
            Conflict.SETUP_ORDER_SET,
            `mandate ${id} already has a setup order`,
          );
        }
        if ([...mandates.values()].some((r) => r.mandate.setupOrderId === orderId)) {
          throw new ConflictError(
            Conflict.SETUP_ORDER_IN_USE,
            "setup order belongs to another mandate",
          );
        }
        record.mandate = { ...mandate, setupOrderId: orderId };
        return copy(record.mandate);
      },

      async activate(id, vault, now) {
        const record = mandateOrThrow(id);
        const kind = classifyMove(MANDATE_TRANSITIONS, record.mandate.status, "ACTIVE");
        if (kind === "stale") {
          return { value: copy(record.mandate), result: "stale" };
        }
        if (kind === "unchanged") {
          if (record.vaultId === vault.vaultId) {
            return { value: copy(record.mandate), result: "unchanged" };
          }
          throw new ConflictError(
            Conflict.MANDATE_VAULT_SET,
            `mandate ${id} has a different vault id`,
          );
        }
        if ([...mandates.values()].some((r) => r !== record && r.vaultId === vault.vaultId)) {
          throw new ConflictError(Conflict.VAULT_ID_IN_USE, "vault id belongs to another mandate");
        }
        record.vaultId = vault.vaultId;
        record.mandate = {
          ...record.mandate,
          status: "ACTIVE",
          paypalCustomerId: vault.paypalCustomerId,
          hasVaultId: true,
          activatedAt: now,
        };
        return { value: copy(record.mandate), result: "applied" };
      },

      async revoke(id, now) {
        const record = mandateOrThrow(id);
        if (record.mandate.status === "REVOKED") {
          return { value: copy(record.mandate), result: "unchanged" };
        }
        record.mandate = { ...record.mandate, status: "REVOKED", revokedAt: now };
        return { value: copy(record.mandate), result: "applied" };
      },

      async vaultIdForCharge(id) {
        const record = mandates.get(id);
        return record?.mandate.status === "ACTIVE" ? record.vaultId : null;
      },

      async vaultIdForDeletion(id) {
        const record = mandates.get(id);
        return record?.mandate.status === "REVOKED" && record.mandate.vaultDeletedAt === null
          ? record.vaultId
          : null;
      },

      async markVaultDeleted(id, now) {
        const record = mandateOrThrow(id);
        if (record.mandate.vaultDeletedAt !== null) {
          return { value: copy(record.mandate), result: "unchanged" };
        }
        if (record.mandate.status !== "REVOKED" || record.vaultId === null) {
          throw new InvariantError(
            `mandate ${id}: only a revoked mandate's vaulted method is deleted (status ${record.mandate.status})`,
          );
        }
        record.mandate = { ...record.mandate, vaultDeletedAt: now };
        return { value: copy(record.mandate), result: "applied" };
      },

      async listAwaitingVaultDeletion(limit) {
        return [...mandates.values()]
          .filter(
            (r) =>
              r.mandate.status === "REVOKED" &&
              r.vaultId !== null &&
              r.mandate.vaultDeletedAt === null,
          )
          .sort(
            (a, b) =>
              (a.mandate.revokedAt?.getTime() ?? 0) - (b.mandate.revokedAt?.getTime() ?? 0) ||
              (a.mandate.id < b.mandate.id ? -1 : 1),
          )
          .slice(0, limit)
          .map((r) => copy(r.mandate));
      },

      async listPendingSetup(createdBefore, limit) {
        return [...mandates.values()]
          .map((r) => r.mandate)
          .filter(
            (m) =>
              m.status === "PENDING" &&
              m.setupOrderId !== null &&
              m.createdAt.getTime() < createdBefore.getTime(),
          )
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))
          .slice(0, limit)
          .map((m) => copy(m));
      },

      async currentPolicy(id) {
        const policy = latestPolicy(id);
        if (policy === undefined) {
          throw new NotFoundError("mandate", id);
        }
        return copy(policy);
      },

      async policy(id, version) {
        const policy = policies.get(id)?.find((p) => p.version === version);
        return policy === undefined ? null : copy(policy);
      },

      async updatePolicy(id, changes) {
        const record = mandateOrThrow(id);
        if (record.mandate.status === "REVOKED") {
          throw new MandateNotActiveError(id, record.mandate.status);
        }
        const current = latestPolicy(id);
        if (current === undefined) {
          throw new InvariantError(`mandate ${id} has no policy`);
        }
        const next = PolicySchema.safeParse({
          ...current,
          ...changes,
          version: current.version + 1,
        });
        if (!next.success) {
          throw new InvariantError(`invalid policy: ${next.error.message}`);
        }
        policies.get(id)?.push(copy(next.data));
        return copy(next.data);
      },
    },

    agents: {
      async create(input) {
        if (!mandates.has(input.mandateId)) {
          throw new InvariantError(`mandate ${input.mandateId} does not exist`);
        }
        if (agents.has(input.id)) {
          throw new ConflictError(Conflict.AGENT_EXISTS, `agent ${input.id} exists`);
        }
        if ([...agents.values()].some((a) => a.apiKeyHash === input.apiKeyHash)) {
          throw new ConflictError(Conflict.API_KEY_IN_USE, "api key in use");
        }
        if (input.name.trim().length === 0) {
          throw new InvariantError("agent name is empty");
        }
        const agent: Agent = {
          id: input.id,
          mandateId: input.mandateId,
          name: input.name,
          apiKeyPrefix: input.apiKeyPrefix,
          createdAt: input.now,
          revokedAt: null,
        };
        agents.set(agent.id, { agent: copy(agent), apiKeyHash: input.apiKeyHash });
        return copy(agent);
      },

      async get(id) {
        const record = agents.get(id);
        return record === undefined ? null : copy(record.agent);
      },

      async authenticate(apiKeyHash) {
        const record = [...agents.values()].find(
          (a) => a.apiKeyHash === apiKeyHash && a.agent.revokedAt === null,
        );
        if (record === undefined) {
          return null;
        }
        const mandate = mandateOrThrow(record.agent.mandateId);
        const policy = latestPolicy(mandate.mandate.id);
        if (policy === undefined) {
          throw new InvariantError(`mandate ${mandate.mandate.id} has no policy`);
        }
        return { agent: copy(record.agent), mandate: copy(mandate.mandate), policy: copy(policy) };
      },

      async listByMandate(id) {
        return [...agents.values()]
          .filter((a) => a.agent.mandateId === id)
          .sort(
            (a, b) =>
              a.agent.createdAt.getTime() - b.agent.createdAt.getTime() ||
              (a.agent.id < b.agent.id ? -1 : 1),
          )
          .map((a) => copy(a.agent));
      },

      async revoke(id, now) {
        const record = agents.get(id);
        if (record === undefined) {
          throw new NotFoundError("agent", id);
        }
        if (record.agent.revokedAt !== null) {
          return { value: copy(record.agent), result: "unchanged" };
        }
        record.agent = { ...record.agent, revokedAt: now };
        return { value: copy(record.agent), result: "applied" };
      },
    },

    snapshots: {
      async save(snapshot, raw) {
        if (snapshots.has(snapshot.id)) {
          throw new ConflictError(Conflict.SNAPSHOT_EXISTS, `snapshot ${snapshot.id} exists`);
        }
        const parsed = OfferSnapshotSchema.safeParse(jsonRoundTrip(snapshot));
        if (!parsed.success) {
          throw new InvariantError(`invalid snapshot: ${parsed.error.message}`);
        }
        snapshots.set(snapshot.id, {
          json: jsonRoundTrip(snapshot),
          raw: jsonRoundTrip(raw),
          productId: snapshot.productId,
          fetchedAt: snapshot.fetchedAt,
          id: snapshot.id,
        });
      },

      async get(id) {
        const record = snapshots.get(id);
        return record === undefined ? null : OfferSnapshotSchema.parse(copy(record.json));
      },

      async getRaw(id) {
        const record = snapshots.get(id);
        return record === undefined ? null : { raw: copy(record.raw) };
      },

      async latestForProduct(productId) {
        const [latest] = [...snapshots.values()]
          .filter((s) => s.productId === productId)
          .sort(
            (a, b) =>
              b.fetchedAt.getTime() - a.fetchedAt.getTime() ||
              (b.id < a.id ? -1 : b.id > a.id ? 1 : 0),
          );
        return latest === undefined
          ? null
          : (OfferSnapshotSchema.parse(copy(latest.json)) as OfferSnapshot);
      },
    },

    attempts: {
      async record(input) {
        assertDirectRecord(input);
        return recordChecked(input);
      },

      async get(id) {
        const record = attempts.get(id);
        return record === undefined ? null : receiptOf(record);
      },

      async listRecent(agentId, productId, since) {
        return [...attempts.values()]
          .filter(
            (r) =>
              r.attempt.agentId === agentId &&
              r.attempt.productId === productId &&
              r.attempt.createdAt.getTime() >= since.getTime(),
          )
          .sort(newestFirst)
          .map(receiptOf);
      },

      async listByAgent(agentId, request) {
        return pageOf((r) => r.attempt.agentId === agentId, request);
      },

      async listByMandate(mandateId, request) {
        return pageOf((r) => r.attempt.mandateId === mandateId, request);
      },

      async findChild(parentId) {
        const record = [...attempts.values()].find((r) => r.attempt.parentAttemptId === parentId);
        return record === undefined ? null : receiptOf(record);
      },
    },

    payments: {
      async get(attemptId) {
        const payment = payments.get(attemptId);
        return payment === undefined ? null : copy(payment);
      },

      async findByRequestId(requestId) {
        const payment = [...payments.values()].find((p) =>
          p.operations.some((op) => op.requestId === requestId),
        );
        return payment === undefined ? null : copy(payment);
      },

      async findByPaypalOrderId(orderId) {
        const payment = [...payments.values()].find((p) => p.paypalOrderId === orderId);
        return payment === undefined ? null : copy(payment);
      },

      async transition(attemptId, to, input) {
        const current = payments.get(attemptId);
        if (current === undefined) {
          throw new NotFoundError("payment", attemptId);
        }
        const plan = planPaymentTransition(copy(current), to, input);
        commitPaymentPlan(plan);
        return { value: copy(payments.get(attemptId) as Payment), result: plan.result };
      },

      async listStale(statuses, updatedBefore, page) {
        const { after } = page;
        const byChange = (
          a: { updatedAt: Date; attemptId: string },
          b: { updatedAt: Date; attemptId: string },
        ) =>
          a.updatedAt.getTime() - b.updatedAt.getTime() ||
          (a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0);
        return [...payments.values()]
          .filter(
            (p) =>
              statuses.includes(p.status) &&
              p.updatedAt.getTime() < updatedBefore.getTime() &&
              (after === undefined || byChange(p, after) > 0),
          )
          .sort(byChange)
          .slice(0, page.limit)
          .map((p) => copy(p));
      },

      async events(attemptId) {
        return copy(events.get(attemptId) ?? []);
      },
    },

    holds: {
      async get(attemptId) {
        const hold = holds.get(attemptId);
        return hold === undefined ? null : copy(hold);
      },

      async approve(attemptId, input) {
        return decideHold(attemptId, {
          kind: "approve",
          by: input.by,
          now: input.now,
          requestId: input.captureRequestId,
        });
      },

      async decline(attemptId, input) {
        return decideHold(attemptId, {
          kind: "decline",
          by: input.by,
          now: input.now,
          requestId: input.voidRequestId,
        });
      },

      async expire(attemptId, input) {
        return decideHold(attemptId, {
          kind: "expire",
          now: input.now,
          requestId: input.voidRequestId,
        });
      },

      async listPending(mandateId) {
        return [...holds.values()]
          .filter(
            (h) =>
              h.status === "PENDING" && attempts.get(h.attemptId)?.attempt.mandateId === mandateId,
          )
          .sort(
            (a, b) =>
              a.createdAt.getTime() - b.createdAt.getTime() || (a.attemptId < b.attemptId ? -1 : 1),
          )
          .map((h) => receiptOf(attempts.get(h.attemptId) as AttemptRecord));
      },

      async listOpen(agentId, productId) {
        return [...holds.values()]
          .filter((h) => h.status === "PENDING")
          .map((h) => attempts.get(h.attemptId) as AttemptRecord)
          .filter((r) => r.attempt.agentId === agentId && r.attempt.productId === productId)
          .sort(newestFirst)
          .map(receiptOf);
      },

      async listPendingOnRevokedMandates(limit) {
        return [...holds.values()]
          .filter(
            (h) =>
              h.status === "PENDING" &&
              mandates.get(attempts.get(h.attemptId)?.attempt.mandateId ?? "")?.mandate.status ===
                "REVOKED",
          )
          .sort(
            (a, b) =>
              a.createdAt.getTime() - b.createdAt.getTime() || (a.attemptId < b.attemptId ? -1 : 1),
          )
          .slice(0, limit)
          .map((h) => receiptOf(attempts.get(h.attemptId) as AttemptRecord));
      },

      async listExpiring(now, limit) {
        return [...holds.values()]
          .filter((h) => h.status === "PENDING" && h.expiresAt.getTime() <= now.getTime())
          .sort(
            (a, b) =>
              a.expiresAt.getTime() - b.expiresAt.getTime() || (a.attemptId < b.attemptId ? -1 : 1),
          )
          .slice(0, limit)
          .map((h) => copy(h));
      },

      async approveWithFollowUp(input) {
        const hold = holds.get(input.attemptId);
        if (hold === undefined) {
          throw new NotFoundError("hold", input.attemptId);
        }
        const parent = attempts.get(input.attemptId);
        if (parent === undefined) {
          throw new NotFoundError("attempt", input.attemptId);
        }
        const parentPayment = payments.get(input.attemptId);
        const approved = planApprovalWithFollowUp(
          copy(hold),
          toAttempt(parent),
          parentPayment === undefined ? null : copy(parentPayment),
          { by: input.by, followUp: input.followUp },
        );
        // recordChecked refuses before changing anything, so a refused follow-up leaves the
        // hold PENDING — the in-memory equivalent of the Postgres transaction rollback.
        const recorded = recordChecked(input.followUp);
        holds.set(input.attemptId, copy(approved));
        return { hold: copy(approved), recorded };
      },
    },

    webhooks: {
      async recordOnce(event) {
        const existing = webhooks.get(event.id);
        if (existing !== undefined) {
          return { inserted: false, processedAt: existing.processedAt };
        }
        webhooks.set(event.id, {
          ...copy(event),
          payload: jsonRoundTrip(event.payload),
          processedAt: null,
        });
        return { inserted: true, processedAt: null };
      },

      async markProcessed(id, now) {
        const event = webhooks.get(id);
        if (event === undefined) {
          throw new NotFoundError("webhook event", id);
        }
        if (event.processedAt === null) {
          event.processedAt = now;
        }
      },

      async listUnprocessed(limit) {
        return [...webhooks.values()]
          .filter((e) => e.processedAt === null)
          .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || (a.id < b.id ? -1 : 1))
          .slice(0, limit)
          .map((e) => copy(e));
      },
    },

    leases: {
      async acquire(key, holder, ttlMs, now) {
        if (!agents.has(key.agentId)) {
          throw new InvariantError(`agent ${key.agentId} does not exist`);
        }
        const id = leaseKeyString(key);
        const existing = leases.get(id);
        if (
          existing === undefined ||
          existing.expiresAt.getTime() <= now.getTime() ||
          existing.holder === holder
        ) {
          leases.set(id, { holder, expiresAt: new Date(now.getTime() + ttlMs) });
          return true;
        }
        return false;
      },

      async release(key, holder) {
        const id = leaseKeyString(key);
        if (leases.get(id)?.holder === holder) {
          leases.delete(id);
        }
      },
    },

    reports: {
      async agentReport(agentId): Promise<AgentReport> {
        const mine = [...attempts.values()].filter(
          (r) => r.attempt.agentId === agentId && r.attempt.origin === "AGENT",
        );
        const results = mine.map((r) => ({
          outcome: r.outcome,
          result: parseStoredCheckResult(1, r.checkResultJson),
        }));
        const overpaid = results.filter((r) => (r.result.gapAbsCents ?? 0) > 0);
        const pcts = overpaid.map((r) => r.result.gapPctHundredths ?? 0);
        const abs = overpaid.map((r) => r.result.gapAbsCents ?? 0);
        return {
          agentId,
          attempted: results.length,
          paid: results.filter((r) => r.outcome === "PAID").length,
          rejected: results.filter((r) => r.outcome === "REJECTED").length,
          held: results.filter((r) => r.outcome === "HELD").length,
          captured: [...payments.values()].filter(
            (p) => p.agentId === agentId && p.status === "CAPTURED",
          ).length,
          notCheapest: overpaid.length,
          medianGapPctHundredths: lowerMedian(pcts),
          worstGapPctHundredths: pcts.length === 0 ? null : Math.max(...pcts),
          worstGapAbsCents:
            abs.length === 0 ? null : (Math.max(...abs) as AgentReport["worstGapAbsCents"]),
          steered: results.filter((r) => r.result.ruleCodes.includes("R3_STEERED")).length,
          conflicts: results.filter((r) => r.result.conflict).length,
        };
      },
    },
  };
}
