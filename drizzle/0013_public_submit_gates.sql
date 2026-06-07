ALTER TABLE "boards" ADD COLUMN "resubmit_status_id" integer;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "receipt_from_status_id" integer;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "receipt_to_status_id" integer;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "resubmitted_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boards" ADD CONSTRAINT "boards_resubmit_status_id_board_statuses_id_fk" FOREIGN KEY ("resubmit_status_id") REFERENCES "public"."board_statuses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boards" ADD CONSTRAINT "boards_receipt_from_status_id_board_statuses_id_fk" FOREIGN KEY ("receipt_from_status_id") REFERENCES "public"."board_statuses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boards" ADD CONSTRAINT "boards_receipt_to_status_id_board_statuses_id_fk" FOREIGN KEY ("receipt_to_status_id") REFERENCES "public"."board_statuses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
