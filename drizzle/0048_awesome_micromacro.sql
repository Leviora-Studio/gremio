ALTER TABLE "inventory_boards" ADD COLUMN "loan_board_id" integer;--> statement-breakpoint
ALTER TABLE "inventory_boards" ADD COLUMN "loan_active_status_id" integer;--> statement-breakpoint
ALTER TABLE "inventory_boards" ADD COLUMN "loan_returned_status_id" integer;--> statement-breakpoint
ALTER TABLE "inventory_loans" ADD COLUMN "card_id" integer;--> statement-breakpoint
ALTER TABLE "inventory_boards" ADD CONSTRAINT "inventory_boards_loan_board_id_boards_id_fk" FOREIGN KEY ("loan_board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_boards" ADD CONSTRAINT "inventory_boards_loan_active_status_id_board_statuses_id_fk" FOREIGN KEY ("loan_active_status_id") REFERENCES "public"."board_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_boards" ADD CONSTRAINT "inventory_boards_loan_returned_status_id_board_statuses_id_fk" FOREIGN KEY ("loan_returned_status_id") REFERENCES "public"."board_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_loans" ADD CONSTRAINT "inventory_loans_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;