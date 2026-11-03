CREATE TABLE "admissions" (
	"address" text PRIMARY KEY NOT NULL,
	"at" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "admissions_updated_at_idx" ON "admissions" USING btree ("updated_at");