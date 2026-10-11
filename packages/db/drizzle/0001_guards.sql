-- Slip guards: status moves, set-once fields, immutable columns and append-only tables, enforced
-- by the database as well as by the code (defence in depth). The transition tables below mirror
-- @slip/domain exactly; `guards.test.ts` compares them row for row, so they cannot drift.
--
-- Error codes: 23514 check_violation for an illegal status, 23001 restrict_violation for a write
-- to something immutable. The store maps both to InvariantError.

CREATE TABLE "slip_payment_transitions" (
	"intent" text NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	CONSTRAINT "slip_payment_transitions_pk" PRIMARY KEY ("intent", "from_status", "to_status")
);
--> statement-breakpoint
INSERT INTO "slip_payment_transitions" ("intent", "from_status", "to_status") VALUES
	('CAPTURE', 'INITIATED', 'UNKNOWN'),
	('CAPTURE', 'INITIATED', 'PENDING'),
	('CAPTURE', 'INITIATED', 'CAPTURED'),
	('CAPTURE', 'INITIATED', 'FAILED'),
	('CAPTURE', 'UNKNOWN', 'PENDING'),
	('CAPTURE', 'UNKNOWN', 'CAPTURED'),
	('CAPTURE', 'UNKNOWN', 'FAILED'),
	('CAPTURE', 'PENDING', 'CAPTURED'),
	('CAPTURE', 'PENDING', 'FAILED'),
	('AUTHORIZE', 'INITIATED', 'UNKNOWN'),
	('AUTHORIZE', 'INITIATED', 'PENDING'),
	('AUTHORIZE', 'INITIATED', 'AUTHORIZED'),
	('AUTHORIZE', 'INITIATED', 'FAILED'),
	('AUTHORIZE', 'INITIATED', 'VOIDED'),
	('AUTHORIZE', 'UNKNOWN', 'PENDING'),
	('AUTHORIZE', 'UNKNOWN', 'AUTHORIZED'),
	('AUTHORIZE', 'UNKNOWN', 'FAILED'),
	('AUTHORIZE', 'UNKNOWN', 'VOIDED'),
	('AUTHORIZE', 'PENDING', 'AUTHORIZED'),
	('AUTHORIZE', 'PENDING', 'FAILED'),
	('AUTHORIZE', 'PENDING', 'VOIDED'),
	('AUTHORIZE', 'AUTHORIZED', 'CAPTURING'),
	('AUTHORIZE', 'AUTHORIZED', 'VOIDING'),
	('AUTHORIZE', 'AUTHORIZED', 'VOIDED'),
	('AUTHORIZE', 'CAPTURING', 'CAPTURED'),
	('AUTHORIZE', 'CAPTURING', 'FAILED'),
	('AUTHORIZE', 'CAPTURING', 'VOIDING'),
	('AUTHORIZE', 'CAPTURING', 'VOIDED'),
	('AUTHORIZE', 'VOIDING', 'VOIDED');
--> statement-breakpoint
CREATE TABLE "slip_mandate_transitions" (
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	CONSTRAINT "slip_mandate_transitions_pk" PRIMARY KEY ("from_status", "to_status")
);
--> statement-breakpoint
INSERT INTO "slip_mandate_transitions" ("from_status", "to_status") VALUES
	('PENDING', 'ACTIVE'),
	('PENDING', 'REVOKED'),
	('ACTIVE', 'REVOKED');
--> statement-breakpoint
CREATE TABLE "slip_hold_transitions" (
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	CONSTRAINT "slip_hold_transitions_pk" PRIMARY KEY ("from_status", "to_status")
);
--> statement-breakpoint
INSERT INTO "slip_hold_transitions" ("from_status", "to_status") VALUES
	('PENDING', 'APPROVED'),
	('PENDING', 'DECLINED'),
	('PENDING', 'EXPIRED');
--> statement-breakpoint
CREATE FUNCTION "slip_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION '% is append-only; % refused', TG_TABLE_NAME, TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "offer_snapshots_append_only" BEFORE UPDATE OR DELETE ON "offer_snapshots"
	FOR EACH ROW EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "offer_snapshots_no_truncate" BEFORE TRUNCATE ON "offer_snapshots"
	FOR EACH STATEMENT EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "policies_append_only" BEFORE UPDATE OR DELETE ON "policies"
	FOR EACH ROW EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "policies_no_truncate" BEFORE TRUNCATE ON "policies"
	FOR EACH STATEMENT EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "attempts_append_only" BEFORE UPDATE OR DELETE ON "attempts"
	FOR EACH ROW EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "attempts_no_truncate" BEFORE TRUNCATE ON "attempts"
	FOR EACH STATEMENT EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "payment_operations_append_only" BEFORE UPDATE OR DELETE ON "payment_operations"
	FOR EACH ROW EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "payment_operations_no_truncate" BEFORE TRUNCATE ON "payment_operations"
	FOR EACH STATEMENT EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "payment_events_append_only" BEFORE UPDATE OR DELETE ON "payment_events"
	FOR EACH ROW EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "payment_events_no_truncate" BEFORE TRUNCATE ON "payment_events"
	FOR EACH STATEMENT EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "slip_payment_transitions_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "slip_payment_transitions"
	FOR EACH ROW EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "slip_mandate_transitions_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "slip_mandate_transitions"
	FOR EACH ROW EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE TRIGGER "slip_hold_transitions_append_only" BEFORE INSERT OR UPDATE OR DELETE ON "slip_hold_transitions"
	FOR EACH ROW EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE FUNCTION "slip_payments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'payment %: payments are never deleted', OLD.attempt_id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF TG_OP = 'INSERT' THEN
		IF NEW.status <> 'INITIATED' THEN
			RAISE EXCEPTION 'payment %: a payment starts INITIATED, not %', NEW.attempt_id, NEW.status
				USING ERRCODE = 'check_violation';
		END IF;
		RETURN NEW;
	END IF;
	IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
		OR NEW.attempt_outcome IS DISTINCT FROM OLD.attempt_outcome
		OR NEW.agent_id IS DISTINCT FROM OLD.agent_id
		OR NEW.product_id IS DISTINCT FROM OLD.product_id
		OR NEW.intent IS DISTINCT FROM OLD.intent
		OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
		OR NEW.currency IS DISTINCT FROM OLD.currency
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'payment %: identity, intent and amount are immutable', OLD.attempt_id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF (OLD.paypal_order_id IS NOT NULL AND NEW.paypal_order_id IS DISTINCT FROM OLD.paypal_order_id)
		OR (OLD.authorization_id IS NOT NULL AND NEW.authorization_id IS DISTINCT FROM OLD.authorization_id)
		OR (OLD.capture_id IS NOT NULL AND NEW.capture_id IS DISTINCT FROM OLD.capture_id)
		OR (OLD.failure_reason IS NOT NULL AND NEW.failure_reason IS DISTINCT FROM OLD.failure_reason) THEN
		RAISE EXCEPTION 'payment %: PayPal ids and the failure reason are set once', OLD.attempt_id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.status <> OLD.status AND NOT EXISTS (
		SELECT 1 FROM "slip_payment_transitions" t
		WHERE t.intent = OLD.intent AND t.from_status = OLD.status AND t.to_status = NEW.status
	) THEN
		RAISE EXCEPTION 'payment %: % payment cannot move from % to %',
			OLD.attempt_id, OLD.intent, OLD.status, NEW.status
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "payments_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payments"
	FOR EACH ROW EXECUTE FUNCTION "slip_payments_guard"();
--> statement-breakpoint
CREATE TRIGGER "payments_no_truncate" BEFORE TRUNCATE ON "payments"
	FOR EACH STATEMENT EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE FUNCTION "slip_mandates_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'mandate %: mandates are never deleted', OLD.id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF TG_OP = 'INSERT' THEN
		IF NEW.status <> 'PENDING' OR NEW.vault_id_ciphertext IS NOT NULL THEN
			RAISE EXCEPTION 'mandate %: a mandate starts PENDING with no vault id', NEW.id
				USING ERRCODE = 'check_violation';
		END IF;
		RETURN NEW;
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'mandate %: id, owner and creation time are immutable', OLD.id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF (OLD.setup_order_id IS NOT NULL AND NEW.setup_order_id IS DISTINCT FROM OLD.setup_order_id)
		OR (OLD.paypal_customer_id IS NOT NULL AND NEW.paypal_customer_id IS DISTINCT FROM OLD.paypal_customer_id)
		OR (OLD.vault_id_ciphertext IS NOT NULL AND NEW.vault_id_ciphertext IS DISTINCT FROM OLD.vault_id_ciphertext)
		OR (OLD.vault_id_hmac IS NOT NULL AND NEW.vault_id_hmac IS DISTINCT FROM OLD.vault_id_hmac)
		OR (OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at)
		OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
		RAISE EXCEPTION 'mandate %: setup order, vault id and timestamps are set once', OLD.id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.status <> OLD.status AND NOT EXISTS (
		SELECT 1 FROM "slip_mandate_transitions" t
		WHERE t.from_status = OLD.status AND t.to_status = NEW.status
	) THEN
		RAISE EXCEPTION 'mandate %: cannot move from % to %', OLD.id, OLD.status, NEW.status
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "mandates_guard" BEFORE INSERT OR UPDATE OR DELETE ON "mandates"
	FOR EACH ROW EXECUTE FUNCTION "slip_mandates_guard"();
--> statement-breakpoint
CREATE TRIGGER "mandates_no_truncate" BEFORE TRUNCATE ON "mandates"
	FOR EACH STATEMENT EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE FUNCTION "slip_holds_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'hold %: holds are never deleted', OLD.attempt_id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF TG_OP = 'INSERT' THEN
		IF NEW.status <> 'PENDING' THEN
			RAISE EXCEPTION 'hold %: a hold starts PENDING, not %', NEW.attempt_id, NEW.status
				USING ERRCODE = 'check_violation';
		END IF;
		RETURN NEW;
	END IF;
	IF NEW.attempt_id IS DISTINCT FROM OLD.attempt_id
		OR NEW.attempt_outcome IS DISTINCT FROM OLD.attempt_outcome
		OR NEW.created_at IS DISTINCT FROM OLD.created_at
		OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
		RAISE EXCEPTION 'hold %: attempt, creation and expiry are immutable', OLD.attempt_id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF (OLD.decided_at IS NOT NULL AND NEW.decided_at IS DISTINCT FROM OLD.decided_at)
		OR (OLD.decided_by IS NOT NULL AND NEW.decided_by IS DISTINCT FROM OLD.decided_by) THEN
		RAISE EXCEPTION 'hold %: a decision is set once', OLD.attempt_id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.status <> OLD.status AND NOT EXISTS (
		SELECT 1 FROM "slip_hold_transitions" t
		WHERE t.from_status = OLD.status AND t.to_status = NEW.status
	) THEN
		RAISE EXCEPTION 'hold %: cannot move from % to %', OLD.attempt_id, OLD.status, NEW.status
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "holds_guard" BEFORE INSERT OR UPDATE OR DELETE ON "holds"
	FOR EACH ROW EXECUTE FUNCTION "slip_holds_guard"();
--> statement-breakpoint
CREATE TRIGGER "holds_no_truncate" BEFORE TRUNCATE ON "holds"
	FOR EACH STATEMENT EXECUTE FUNCTION "slip_append_only"();
--> statement-breakpoint
CREATE FUNCTION "slip_agents_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'agent %: agents are revoked, never deleted', OLD.id
			USING ERRCODE = 'restrict_violation';
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.mandate_id IS DISTINCT FROM OLD.mandate_id
		OR NEW.api_key_hash IS DISTINCT FROM OLD.api_key_hash
		OR NEW.created_at IS DISTINCT FROM OLD.created_at
		OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
		RAISE EXCEPTION 'agent %: only an unrevoked agent can change, and only to be revoked', OLD.id
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "agents_guard" BEFORE UPDATE OR DELETE ON "agents"
	FOR EACH ROW EXECUTE FUNCTION "slip_agents_guard"();
--> statement-breakpoint
CREATE FUNCTION "slip_webhook_events_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.payload IS DISTINCT FROM OLD.payload
		OR NEW.received_at IS DISTINCT FROM OLD.received_at
		OR (OLD.processed_at IS NOT NULL AND NEW.processed_at IS DISTINCT FROM OLD.processed_at) THEN
		RAISE EXCEPTION 'webhook event %: only processed_at may be set, once', OLD.id
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "webhook_events_guard" BEFORE UPDATE ON "webhook_events"
	FOR EACH ROW EXECUTE FUNCTION "slip_webhook_events_guard"();
