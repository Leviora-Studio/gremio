ALTER TABLE "inventory_loans" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_loans" ADD COLUMN "token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_loans_token_uq" ON "inventory_loans" USING btree ("token");--> statement-breakpoint
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_status" CHECK ("inventory_loans"."status" in ('requested','active','returned','rejected'));