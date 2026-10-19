CREATE TABLE "search_impressions" (
	"agent_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"text" text NOT NULL,
	"shown_at" timestamp with time zone NOT NULL,
	CONSTRAINT "search_impressions_pk" PRIMARY KEY("agent_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "attempts" DROP CONSTRAINT "attempts_rule_codes_valid";--> statement-breakpoint
ALTER TABLE "search_impressions" ADD CONSTRAINT "search_impressions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_impressions_shown_at_idx" ON "search_impressions" USING btree ("shown_at");--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_rule_codes_valid" CHECK (cardinality("attempts"."rule_codes") >= 1 and "attempts"."rule_codes" <@ array['R1_STALE_SNAPSHOT', 'VARIANT_MISMATCH', 'OFFER_NOT_FOUND', 'CHOSEN_UNAVAILABLE', 'CHOSEN_UNVERIFIED', 'R2_TOO_FEW_OFFERS', 'R2A_GAP_IMPLAUSIBLE', 'R3_STEERED', 'R4_OVERPAID', 'R4A_NO_CLASSIFIER_ANSWER', 'R5_COMMISSION_CONFLICT', 'R6_ABOVE_ORDER_CAP', 'R7_WITHIN_LIMITS', 'OWNER_APPROVED']::text[]);