CREATE TABLE "card_budget_positions" (
	"id" text PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"position" integer NOT NULL,
	"budget_title" text,
	"description" text,
	"account_id" integer NOT NULL,
	"requested_amount" integer,
	"approved_amount" integer,
	"actual_amount" integer,
	CONSTRAINT "card_budget_positions_amounts" CHECK (("card_budget_positions"."requested_amount" is null or "card_budget_positions"."requested_amount" between 0 and 2000000000) and ("card_budget_positions"."approved_amount" is null or "card_budget_positions"."approved_amount" between 0 and 2000000000) and ("card_budget_positions"."actual_amount" is null or "card_budget_positions"."actual_amount" between 0 and 2000000000))
);
--> statement-breakpoint
DROP INDEX "board_template_statuses_one_trigger";--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "upload_purpose" text;--> statement-breakpoint
ALTER TABLE "board_statuses" ADD COLUMN "is_receipt_trigger" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "budget_mode" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "budget_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "card_budget_positions" ADD CONSTRAINT "card_budget_positions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_budget_positions" ADD CONSTRAINT "card_budget_positions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_budget_positions_card_idx" ON "card_budget_positions" USING btree ("card_id","position");--> statement-breakpoint
CREATE INDEX "card_budget_positions_account_idx" ON "card_budget_positions" USING btree ("account_id");
--> statement-breakpoint
-- Preserve the existing source only when it belongs to its configured board.
UPDATE board_statuses s SET is_receipt_trigger = true
FROM boards b WHERE b.receipt_from_status_id = s.id AND s.board_id = b.id;
