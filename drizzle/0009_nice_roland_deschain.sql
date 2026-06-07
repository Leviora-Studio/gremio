ALTER TABLE "board_statuses" ADD COLUMN "is_instruction_trigger" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "default_account_id" integer;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "instruction_date" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "approved_amount" integer;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "actual_amount" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boards" ADD CONSTRAINT "boards_default_account_id_accounts_id_fk" FOREIGN KEY ("default_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "board_statuses_one_instr_trigger" ON "board_statuses" USING btree ("board_id") WHERE "board_statuses"."is_instruction_trigger" = true;