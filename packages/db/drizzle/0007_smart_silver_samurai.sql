ALTER TABLE "mandates" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mandates" ADD COLUMN "reconcile_unmatched" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_reconcile_unmatched_non_negative" CHECK ("mandates"."reconcile_unmatched" >= 0);