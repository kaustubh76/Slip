import { OUTCOMES, RULE_CODES, RULE_OUTCOME } from "@slip/domain";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Slip's Postgres schema. Statuses are `text` + CHECK rather than pg enums (enums are painful to
 * evolve). Money is integer cents. Ids are application-generated UUIDs so a row can be referenced
 * before it is written (write-ahead). Rules the domain enforces in code are repeated here as
 * constraints; status moves, set-once fields and append-only tables are enforced by triggers in
 * the hand-written migration `0001_guards.sql`.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const PAYMENT_STATUS_SQL = inList([
  "INITIATED",
  "UNKNOWN",
  "PENDING",
  "AUTHORIZED",
  "CAPTURING",
  "VOIDING",
  "CAPTURED",
  "VOIDED",
  "FAILED",
]);

const RULE_CODE_SQL = inList(RULE_CODES);

/**
 * The outcome each rule code must carry, as CASE branches built from the domain's own map rather
 * than written out by hand. A rule code left out of the CASE makes it `null`, `outcome = null` is
 * `null`, and a `null` CHECK **passes** — so a hand-written list does not fail loudly when a rule
 * is added, it just stops enforcing that rule. That is what happened to `R2A_GAP_IMPLAUSIBLE`
 * between D68 and D74; generating the branches is what stops it happening again.
 */
const RULE_OUTCOME_SQL = sql.raw(
  OUTCOMES.map(
    (outcome) =>
      `when rule_code in (${RULE_CODES.filter((code) => RULE_OUTCOME[code] === outcome)
        .map((code) => `'${code}'`)
        .join(", ")}) then '${outcome}'`,
  ).join(" "),
);

export const owners = pgTable("owners", {
  id: uuid("id").primaryKey(),
  email: text("email").unique("owners_email_unique"),
  /**
   * `scrypt$N$r$p$salt$key`, or null for an owner whose only credential is their session cookie
   * (every demo desk, and every owner opened before D71).
   */
  passwordHash: text("password_hash"),
  createdAt: ts("created_at").notNull(),
});

export const mandates = pgTable(
  "mandates",
  {
    id: uuid("id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => owners.id),
    status: text("status").notNull(),
    setupOrderId: text("setup_order_id").unique("mandates_setup_order_unique"),
    paypalCustomerId: text("paypal_customer_id"),
    /** AES-256-GCM, bound to the mandate id; see crypto.ts. */
    vaultIdCiphertext: text("vault_id_ciphertext"),
    /** HMAC of the vault id, so a VAULT.PAYMENT-TOKEN webhook can find its mandate. */
    vaultIdHmac: text("vault_id_hmac").unique("mandates_vault_hmac_unique"),
    createdAt: ts("created_at").notNull(),
    activatedAt: ts("activated_at"),
    revokedAt: ts("revoked_at"),
    /** When PayPal confirmed the vaulted method was deleted after a revoke; set once. */
    vaultDeletedAt: ts("vault_deleted_at"),
    /**
     * When Slip last checked its payments against PayPal's own record, and how many it could not
     * account for then (D75). Operational, not evidence: it is rewritten every pass, unlike every
     * other timestamp here, and losing it costs nothing but an older answer. What was *decided*
     * lives in the append-only attempt.
     */
    reconciledAt: ts("reconciled_at"),
    reconcileUnmatched: integer("reconcile_unmatched").notNull().default(0),
  },
  (t) => [
    check("mandates_status_valid", sql`${t.status} in ('PENDING', 'ACTIVE', 'REVOKED')`),
    check("mandates_reconcile_unmatched_non_negative", sql`${t.reconcileUnmatched} >= 0`),
    check(
      "mandates_vault_deleted_after_revoke",
      sql`${t.vaultDeletedAt} is null or (${t.status} = 'REVOKED' and ${t.vaultIdCiphertext} is not null)`,
    ),
    check(
      "mandates_vault_pair",
      sql`(${t.vaultIdCiphertext} is null) = (${t.vaultIdHmac} is null)`,
    ),
    check(
      "mandates_active_has_vault",
      sql`${t.status} <> 'ACTIVE' or (${t.vaultIdCiphertext} is not null and ${t.activatedAt} is not null)`,
    ),
    check("mandates_revoked_at", sql`(${t.status} = 'REVOKED') = (${t.revokedAt} is not null)`),
    index("mandates_owner_idx").on(t.ownerId),
  ],
);

export const policies = pgTable(
  "policies",
  {
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => mandates.id),
    version: integer("version").notNull(),
    maxOverpayPctHundredths: integer("max_overpay_pct_hundredths").notNull(),
    maxOverpayAbsCents: integer("max_overpay_abs_cents").notNull(),
    flagPctHundredths: integer("flag_pct_hundredths").notNull(),
    orderCapCents: integer("order_cap_cents").notNull(),
    snapshotMaxAgeMs: integer("snapshot_max_age_ms").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "policies_pk", columns: [t.mandateId, t.version] }),
    check("policies_version_positive", sql`${t.version} >= 1`),
    check(
      "policies_pct_bounds",
      sql`${t.maxOverpayPctHundredths} between 0 and 100000 and ${t.flagPctHundredths} between 0 and 100000`,
    ),
    check(
      "policies_cents_bounds",
      sql`${t.maxOverpayAbsCents} between 0 and 100000000 and ${t.orderCapCents} between 0 and 100000000`,
    ),
    check("policies_age_bounds", sql`${t.snapshotMaxAgeMs} between 0 and 86400000`),
  ],
);

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey(),
    mandateId: uuid("mandate_id")
      .notNull()
      .references(() => mandates.id),
    name: text("name").notNull(),
    apiKeyHash: text("api_key_hash").notNull().unique("agents_api_key_hash_unique"),
    apiKeyPrefix: text("api_key_prefix").notNull(),
    createdAt: ts("created_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    // Lets attempts reference (agent, mandate) together: an attempt's mandate is its agent's.
    unique("agents_id_mandate_unique").on(t.id, t.mandateId),
    check("agents_name_present", sql`length(trim(${t.name})) > 0`),
    index("agents_mandate_idx").on(t.mandateId),
  ],
);

export const offerSnapshots = pgTable(
  "offer_snapshots",
  {
    id: uuid("id").primaryKey(),
    productId: text("product_id").notNull(),
    title: text("title").notNull(),
    selectedOptions: jsonb("selected_options").notNull(),
    offers: jsonb("offers").notNull(),
    raw: jsonb("raw"),
    rawHash: text("raw_hash").notNull(),
    fetchedAt: ts("fetched_at").notNull(),
  },
  (t) => [index("offer_snapshots_product_idx").on(t.productId, t.fetchedAt.desc(), t.id.desc())],
);

export const attempts = pgTable(
  "attempts",
  {
    id: uuid("id").primaryKey(),
    agentId: uuid("agent_id").notNull(),
    mandateId: uuid("mandate_id").notNull(),
    productId: text("product_id").notNull(),
    origin: text("origin").notNull(),
    parentAttemptId: uuid("parent_attempt_id"),
    chosenOfferUrl: text("chosen_offer_url").notNull(),
    selectedOptions: jsonb("selected_options"),
    reason: text("reason").notNull(),
    snapshotId: uuid("snapshot_id").references(() => offerSnapshots.id),
    policyVersion: integer("policy_version").notNull(),
    outcome: text("outcome").notNull(),
    ruleCode: text("rule_code").notNull(),
    ruleCodes: text("rule_codes").array().notNull(),
    gapAbsCents: integer("gap_abs_cents"),
    gapPctHundredths: integer("gap_pct_hundredths"),
    chosenPriceCents: integer("chosen_price_cents"),
    bestPriceCents: integer("best_price_cents"),
    conflict: boolean("conflict").notNull(),
    steered: boolean("steered").notNull().generatedAlwaysAs(sql`'R3_STEERED' = any(rule_codes)`),
    checkResultVersion: integer("check_result_version").notNull(),
    checkResult: jsonb("check_result").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "attempts_agent_mandate_fk",
      columns: [t.agentId, t.mandateId],
      foreignColumns: [agents.id, agents.mandateId],
    }),
    foreignKey({
      name: "attempts_policy_fk",
      columns: [t.mandateId, t.policyVersion],
      foreignColumns: [policies.mandateId, policies.version],
    }),
    foreignKey({
      name: "attempts_parent_fk",
      columns: [t.parentAttemptId],
      foreignColumns: [t.id],
    }),
    // One owner-approval follow-up per held attempt.
    unique("attempts_parent_unique").on(t.parentAttemptId),
    // Targets for the payments and holds composite foreign keys.
    unique("attempts_payment_target").on(
      t.id,
      t.outcome,
      t.chosenPriceCents,
      t.agentId,
      t.productId,
    ),
    unique("attempts_hold_target").on(t.id, t.outcome),
    check("attempts_origin_valid", sql`${t.origin} in ('AGENT', 'OWNER_APPROVAL')`),
    check(
      "attempts_origin_parent",
      sql`(${t.origin} = 'AGENT') = (${t.parentAttemptId} is null) and ${t.parentAttemptId} is distinct from ${t.id}`,
    ),
    check("attempts_outcome_valid", sql`${t.outcome} in ('PAID', 'REJECTED', 'HELD')`),
    // Without this, an unknown rule code makes the CASE below NULL, and a NULL CHECK passes.
    check(
      "attempts_rule_codes_valid",
      sql`cardinality(${t.ruleCodes}) >= 1 and ${t.ruleCodes} <@ array[${RULE_CODE_SQL}]::text[]`,
    ),
    check("attempts_rule_first", sql`${t.ruleCode} = ${t.ruleCodes}[1]`),
    check("attempts_outcome_matches_rule", sql`${t.outcome} = case ${RULE_OUTCOME_SQL} end`),
    check(
      "attempts_owner_approved_origin",
      sql`${t.ruleCode} <> 'OWNER_APPROVED' or ${t.origin} = 'OWNER_APPROVAL'`,
    ),
    check("attempts_owner_approval_not_held", sql`${t.origin} = 'AGENT' or ${t.outcome} <> 'HELD'`),
    check("attempts_gap_non_negative", sql`${t.gapAbsCents} is null or ${t.gapAbsCents} >= 0`),
    check(
      "attempts_prices_positive",
      sql`(${t.chosenPriceCents} is null or ${t.chosenPriceCents} > 0) and (${t.bestPriceCents} is null or ${t.bestPriceCents} > 0)`,
    ),
    index("attempts_agent_product_idx").on(t.agentId, t.productId, t.createdAt.desc(), t.id.desc()),
    index("attempts_agent_idx").on(t.agentId, t.createdAt.desc(), t.id.desc()),
    index("attempts_mandate_idx").on(t.mandateId, t.createdAt.desc(), t.id.desc()),
  ],
);

export const payments = pgTable(
  "payments",
  {
    attemptId: uuid("attempt_id").primaryKey(),
    /** Copied from the attempt so the composite foreign key can pin outcome ↔ intent. */
    attemptOutcome: text("attempt_outcome").notNull(),
    agentId: uuid("agent_id").notNull(),
    productId: text("product_id").notNull(),
    intent: text("intent").notNull(),
    status: text("status").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    paypalOrderId: text("paypal_order_id").unique("payments_paypal_order_unique"),
    authorizationId: text("authorization_id").unique("payments_authorization_unique"),
    captureId: text("capture_id").unique("payments_capture_unique"),
    failureReason: text("failure_reason"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [
    // The payment's amount, agent and product are the attempt's — enforced, not trusted.
    foreignKey({
      name: "payments_attempt_fk",
      columns: [t.attemptId, t.attemptOutcome, t.amountCents, t.agentId, t.productId],
      foreignColumns: [
        attempts.id,
        attempts.outcome,
        attempts.chosenPriceCents,
        attempts.agentId,
        attempts.productId,
      ],
    }),
    check(
      "payments_intent_matches_outcome",
      sql`(${t.attemptOutcome} = 'PAID' and ${t.intent} = 'CAPTURE') or (${t.attemptOutcome} = 'HELD' and ${t.intent} = 'AUTHORIZE')`,
    ),
    check("payments_status_valid", sql`${t.status} in (${PAYMENT_STATUS_SQL})`),
    check(
      "payments_capture_intent_statuses",
      sql`${t.intent} = 'AUTHORIZE' or ${t.status} in ('INITIATED', 'UNKNOWN', 'PENDING', 'CAPTURED', 'FAILED')`,
    ),
    check("payments_amount_positive", sql`${t.amountCents} > 0`),
    check("payments_usd_only", sql`${t.currency} = 'USD'`),
    check(
      "payments_required_ids",
      sql`(${t.status} <> 'PENDING' or ${t.paypalOrderId} is not null)
        and (${t.status} not in ('AUTHORIZED', 'CAPTURING', 'VOIDING', 'VOIDED') or (${t.paypalOrderId} is not null and ${t.authorizationId} is not null))
        and (${t.status} <> 'CAPTURED' or (${t.paypalOrderId} is not null and ${t.captureId} is not null))
        and (${t.status} <> 'FAILED' or ${t.failureReason} is not null)`,
    ),
    // At most one payment per (agent, product) with money moving or about to: a backstop to the
    // checkout lease against a double charge.
    uniqueIndex("payments_in_flight_unique")
      .on(t.agentId, t.productId)
      .where(sql`${t.status} in ('INITIATED', 'UNKNOWN', 'PENDING', 'CAPTURING')`),
    index("payments_status_idx").on(t.status, t.updatedAt),
  ],
);

export const paymentOperations = pgTable(
  "payment_operations",
  {
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => payments.attemptId),
    kind: text("kind").notNull(),
    requestId: uuid("request_id").notNull().unique("payment_operations_request_unique"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "payment_operations_pk", columns: [t.attemptId, t.kind] }),
    check("payment_operations_kind_valid", sql`${t.kind} in ('ORDER', 'CAPTURE', 'VOID')`),
  ],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    attemptId: uuid("attempt_id")
      .notNull()
      .references(() => payments.attemptId),
    fromStatus: text("from_status").notNull(),
    toStatus: text("to_status").notNull(),
    detail: jsonb("detail"),
    at: ts("at").notNull(),
  },
  (t) => [index("payment_events_attempt_idx").on(t.attemptId, t.id)],
);

export const holds = pgTable(
  "holds",
  {
    attemptId: uuid("attempt_id").primaryKey(),
    attemptOutcome: text("attempt_outcome").notNull(),
    status: text("status").notNull(),
    createdAt: ts("created_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
    decidedAt: ts("decided_at"),
    decidedBy: text("decided_by"),
  },
  (t) => [
    foreignKey({
      name: "holds_attempt_fk",
      columns: [t.attemptId, t.attemptOutcome],
      foreignColumns: [attempts.id, attempts.outcome],
    }),
    check("holds_only_held", sql`${t.attemptOutcome} = 'HELD'`),
    check("holds_status_valid", sql`${t.status} in ('PENDING', 'APPROVED', 'DECLINED', 'EXPIRED')`),
    check("holds_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
    check(
      "holds_decided_fields",
      sql`(${t.status} = 'PENDING') = (${t.decidedAt} is null) and (${t.decidedAt} is null) = (${t.decidedBy} is null)`,
    ),
    index("holds_pending_expiry_idx").on(t.expiresAt).where(sql`${t.status} = 'PENDING'`),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: text("id").primaryKey(),
    eventType: text("event_type").notNull(),
    resourceId: text("resource_id"),
    payload: jsonb("payload").notNull(),
    receivedAt: ts("received_at").notNull(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    index("webhook_events_unprocessed_idx").on(t.receivedAt).where(sql`${t.processedAt} is null`),
  ],
);

/**
 * What Slip's own search last showed an agent about a product, for the steering check to read at
 * checkout (D69). Keyed like a lease rather than appended like a snapshot, because it is
 * operational and not evidence: the next search overwrites it, the write that follows forgets
 * anything older than half an hour, and no attempt or receipt points at it. Nothing here may be
 * append-only — a table that is pruned cannot carry `slip_append_only()`.
 */
export const searchImpressions = pgTable(
  "search_impressions",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    productId: text("product_id").notNull(),
    /** The product's own words as the agent was shown them. */
    text: text("text").notNull(),
    shownAt: ts("shown_at").notNull(),
  },
  (t) => [
    primaryKey({ name: "search_impressions_pk", columns: [t.agentId, t.productId] }),
    index("search_impressions_shown_at_idx").on(t.shownAt),
  ],
);

export const checkoutLeases = pgTable(
  "checkout_leases",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    productId: text("product_id").notNull(),
    holder: text("holder").notNull(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [primaryKey({ name: "checkout_leases_pk", columns: [t.agentId, t.productId] })],
);
