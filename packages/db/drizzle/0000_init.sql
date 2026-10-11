CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mandate_id" uuid NOT NULL,
	"name" text NOT NULL,
	"api_key_hash" text NOT NULL,
	"api_key_prefix" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "agents_api_key_hash_unique" UNIQUE("api_key_hash"),
	CONSTRAINT "agents_id_mandate_unique" UNIQUE("id","mandate_id"),
	CONSTRAINT "agents_name_present" CHECK (length(trim("agents"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"mandate_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"origin" text NOT NULL,
	"parent_attempt_id" uuid,
	"chosen_offer_url" text NOT NULL,
	"selected_options" jsonb,
	"reason" text NOT NULL,
	"snapshot_id" uuid,
	"policy_version" integer NOT NULL,
	"outcome" text NOT NULL,
	"rule_code" text NOT NULL,
	"rule_codes" text[] NOT NULL,
	"gap_abs_cents" integer,
	"gap_pct_hundredths" integer,
	"chosen_price_cents" integer,
	"best_price_cents" integer,
	"conflict" boolean NOT NULL,
	"steered" boolean GENERATED ALWAYS AS ('R3_STEERED' = any(rule_codes)) STORED NOT NULL,
	"check_result_version" integer NOT NULL,
	"check_result" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "attempts_parent_unique" UNIQUE("parent_attempt_id"),
	CONSTRAINT "attempts_payment_target" UNIQUE("id","outcome","chosen_price_cents","agent_id","product_id"),
	CONSTRAINT "attempts_hold_target" UNIQUE("id","outcome"),
	CONSTRAINT "attempts_origin_valid" CHECK ("attempts"."origin" in ('AGENT', 'OWNER_APPROVAL')),
	CONSTRAINT "attempts_origin_parent" CHECK (("attempts"."origin" = 'AGENT') = ("attempts"."parent_attempt_id" is null) and "attempts"."parent_attempt_id" is distinct from "attempts"."id"),
	CONSTRAINT "attempts_outcome_valid" CHECK ("attempts"."outcome" in ('PAID', 'REJECTED', 'HELD')),
	CONSTRAINT "attempts_rule_codes_valid" CHECK (cardinality("attempts"."rule_codes") >= 1 and "attempts"."rule_codes" <@ array['R1_STALE_SNAPSHOT', 'VARIANT_MISMATCH', 'OFFER_NOT_FOUND', 'CHOSEN_UNAVAILABLE', 'CHOSEN_UNVERIFIED', 'R2_TOO_FEW_OFFERS', 'R3_STEERED', 'R4_OVERPAID', 'R4A_NO_CLASSIFIER_ANSWER', 'R5_COMMISSION_CONFLICT', 'R6_ABOVE_ORDER_CAP', 'R7_WITHIN_LIMITS', 'OWNER_APPROVED']::text[]),
	CONSTRAINT "attempts_rule_first" CHECK ("attempts"."rule_code" = "attempts"."rule_codes"[1]),
	CONSTRAINT "attempts_outcome_matches_rule" CHECK ("attempts"."outcome" = case
        when "attempts"."rule_code" in ('R7_WITHIN_LIMITS', 'OWNER_APPROVED') then 'PAID'
        when "attempts"."rule_code" in ('VARIANT_MISMATCH', 'OFFER_NOT_FOUND', 'CHOSEN_UNAVAILABLE', 'R3_STEERED', 'R4_OVERPAID') then 'REJECTED'
        when "attempts"."rule_code" in ('R1_STALE_SNAPSHOT', 'CHOSEN_UNVERIFIED', 'R2_TOO_FEW_OFFERS', 'R4A_NO_CLASSIFIER_ANSWER', 'R5_COMMISSION_CONFLICT', 'R6_ABOVE_ORDER_CAP') then 'HELD'
      end),
	CONSTRAINT "attempts_owner_approved_origin" CHECK ("attempts"."rule_code" <> 'OWNER_APPROVED' or "attempts"."origin" = 'OWNER_APPROVAL'),
	CONSTRAINT "attempts_owner_approval_not_held" CHECK ("attempts"."origin" = 'AGENT' or "attempts"."outcome" <> 'HELD'),
	CONSTRAINT "attempts_gap_non_negative" CHECK ("attempts"."gap_abs_cents" is null or "attempts"."gap_abs_cents" >= 0),
	CONSTRAINT "attempts_prices_positive" CHECK (("attempts"."chosen_price_cents" is null or "attempts"."chosen_price_cents" > 0) and ("attempts"."best_price_cents" is null or "attempts"."best_price_cents" > 0))
);
--> statement-breakpoint
CREATE TABLE "checkout_leases" (
	"agent_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "checkout_leases_pk" PRIMARY KEY("agent_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "holds" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"attempt_outcome" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" text,
	CONSTRAINT "holds_only_held" CHECK ("holds"."attempt_outcome" = 'HELD'),
	CONSTRAINT "holds_status_valid" CHECK ("holds"."status" in ('PENDING', 'APPROVED', 'DECLINED', 'EXPIRED')),
	CONSTRAINT "holds_expiry_after_creation" CHECK ("holds"."expires_at" > "holds"."created_at"),
	CONSTRAINT "holds_decided_fields" CHECK (("holds"."status" = 'PENDING') = ("holds"."decided_at" is null) and ("holds"."decided_at" is null) = ("holds"."decided_by" is null))
);
--> statement-breakpoint
CREATE TABLE "mandates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" uuid NOT NULL,
	"status" text NOT NULL,
	"setup_order_id" text,
	"paypal_customer_id" text,
	"vault_id_ciphertext" text,
	"vault_id_hmac" text,
	"created_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mandates_setup_order_unique" UNIQUE("setup_order_id"),
	CONSTRAINT "mandates_vault_hmac_unique" UNIQUE("vault_id_hmac"),
	CONSTRAINT "mandates_status_valid" CHECK ("mandates"."status" in ('PENDING', 'ACTIVE', 'REVOKED')),
	CONSTRAINT "mandates_vault_pair" CHECK (("mandates"."vault_id_ciphertext" is null) = ("mandates"."vault_id_hmac" is null)),
	CONSTRAINT "mandates_active_has_vault" CHECK ("mandates"."status" <> 'ACTIVE' or ("mandates"."vault_id_ciphertext" is not null and "mandates"."activated_at" is not null)),
	CONSTRAINT "mandates_revoked_at" CHECK (("mandates"."status" = 'REVOKED') = ("mandates"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "offer_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"title" text NOT NULL,
	"selected_options" jsonb NOT NULL,
	"offers" jsonb NOT NULL,
	"raw" jsonb,
	"raw_hash" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "owners_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payment_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"attempt_id" uuid NOT NULL,
	"from_status" text NOT NULL,
	"to_status" text NOT NULL,
	"detail" jsonb,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_operations" (
	"attempt_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payment_operations_pk" PRIMARY KEY("attempt_id","kind"),
	CONSTRAINT "payment_operations_request_unique" UNIQUE("request_id"),
	CONSTRAINT "payment_operations_kind_valid" CHECK ("payment_operations"."kind" in ('ORDER', 'CAPTURE', 'VOID'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"attempt_outcome" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"intent" text NOT NULL,
	"status" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"paypal_order_id" text,
	"authorization_id" text,
	"capture_id" text,
	"failure_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "payments_paypal_order_unique" UNIQUE("paypal_order_id"),
	CONSTRAINT "payments_authorization_unique" UNIQUE("authorization_id"),
	CONSTRAINT "payments_capture_unique" UNIQUE("capture_id"),
	CONSTRAINT "payments_intent_matches_outcome" CHECK (("payments"."attempt_outcome" = 'PAID' and "payments"."intent" = 'CAPTURE') or ("payments"."attempt_outcome" = 'HELD' and "payments"."intent" = 'AUTHORIZE')),
	CONSTRAINT "payments_status_valid" CHECK ("payments"."status" in ('INITIATED', 'UNKNOWN', 'PENDING', 'AUTHORIZED', 'CAPTURING', 'VOIDING', 'CAPTURED', 'VOIDED', 'FAILED')),
	CONSTRAINT "payments_capture_intent_statuses" CHECK ("payments"."intent" = 'AUTHORIZE' or "payments"."status" in ('INITIATED', 'UNKNOWN', 'PENDING', 'CAPTURED', 'FAILED')),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount_cents" > 0),
	CONSTRAINT "payments_usd_only" CHECK ("payments"."currency" = 'USD'),
	CONSTRAINT "payments_required_ids" CHECK (("payments"."status" <> 'PENDING' or "payments"."paypal_order_id" is not null)
        and ("payments"."status" not in ('AUTHORIZED', 'CAPTURING', 'VOIDING', 'VOIDED') or ("payments"."paypal_order_id" is not null and "payments"."authorization_id" is not null))
        and ("payments"."status" <> 'CAPTURED' or ("payments"."paypal_order_id" is not null and "payments"."capture_id" is not null))
        and ("payments"."status" <> 'FAILED' or "payments"."failure_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "policies" (
	"mandate_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"max_overpay_pct_hundredths" integer NOT NULL,
	"max_overpay_abs_cents" integer NOT NULL,
	"flag_pct_hundredths" integer NOT NULL,
	"order_cap_cents" integer NOT NULL,
	"snapshot_max_age_ms" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "policies_pk" PRIMARY KEY("mandate_id","version"),
	CONSTRAINT "policies_version_positive" CHECK ("policies"."version" >= 1),
	CONSTRAINT "policies_pct_bounds" CHECK ("policies"."max_overpay_pct_hundredths" between 0 and 100000 and "policies"."flag_pct_hundredths" between 0 and 100000),
	CONSTRAINT "policies_cents_bounds" CHECK ("policies"."max_overpay_abs_cents" between 0 and 100000000 and "policies"."order_cap_cents" between 0 and 100000000),
	CONSTRAINT "policies_age_bounds" CHECK ("policies"."snapshot_max_age_ms" between 0 and 86400000)
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_snapshot_id_offer_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."offer_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_agent_mandate_fk" FOREIGN KEY ("agent_id","mandate_id") REFERENCES "public"."agents"("id","mandate_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_policy_fk" FOREIGN KEY ("mandate_id","policy_version") REFERENCES "public"."policies"("mandate_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_parent_fk" FOREIGN KEY ("parent_attempt_id") REFERENCES "public"."attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkout_leases" ADD CONSTRAINT "checkout_leases_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holds" ADD CONSTRAINT "holds_attempt_fk" FOREIGN KEY ("attempt_id","attempt_outcome") REFERENCES "public"."attempts"("id","outcome") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_owner_id_owners_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."owners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_attempt_id_payments_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payments"("attempt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_operations" ADD CONSTRAINT "payment_operations_attempt_id_payments_attempt_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payments"("attempt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_attempt_fk" FOREIGN KEY ("attempt_id","attempt_outcome","amount_cents","agent_id","product_id") REFERENCES "public"."attempts"("id","outcome","chosen_price_cents","agent_id","product_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policies" ADD CONSTRAINT "policies_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "public"."mandates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_mandate_idx" ON "agents" USING btree ("mandate_id");--> statement-breakpoint
CREATE INDEX "attempts_agent_product_idx" ON "attempts" USING btree ("agent_id","product_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attempts_agent_idx" ON "attempts" USING btree ("agent_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "attempts_mandate_idx" ON "attempts" USING btree ("mandate_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "holds_pending_expiry_idx" ON "holds" USING btree ("expires_at") WHERE "holds"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "mandates_owner_idx" ON "mandates" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "offer_snapshots_product_idx" ON "offer_snapshots" USING btree ("product_id","fetched_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payment_events_attempt_idx" ON "payment_events" USING btree ("attempt_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_in_flight_unique" ON "payments" USING btree ("agent_id","product_id") WHERE "payments"."status" in ('INITIATED', 'UNKNOWN', 'PENDING', 'CAPTURING');--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "webhook_events_unprocessed_idx" ON "webhook_events" USING btree ("received_at") WHERE "webhook_events"."processed_at" is null;