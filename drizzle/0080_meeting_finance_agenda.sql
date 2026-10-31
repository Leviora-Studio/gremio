ALTER TABLE "meeting_areas" ADD COLUMN "finance_board_id" integer;--> statement-breakpoint
ALTER TABLE "meeting_areas" ADD COLUMN "finance_source_status_ids" integer[] DEFAULT '{}'::integer[] NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_areas" ADD COLUMN "finance_target_status_id" integer;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD COLUMN "is_finance_topic" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD COLUMN "is_finance_item" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD COLUMN "finance_card_id" integer;--> statement-breakpoint
ALTER TABLE "meeting_areas" ADD CONSTRAINT "meeting_areas_finance_board_id_boards_id_fk" FOREIGN KEY ("finance_board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_areas" ADD CONSTRAINT "meeting_areas_finance_target_status_id_board_statuses_id_fk" FOREIGN KEY ("finance_target_status_id") REFERENCES "public"."board_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_finance_card_id_cards_id_fk" FOREIGN KEY ("finance_card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_topics_finance_root_uq" ON "meeting_topics" USING btree ("meeting_id") WHERE "meeting_topics"."is_finance_topic" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_topics_finance_card_uq" ON "meeting_topics" USING btree ("meeting_id","finance_card_id");--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_finance_root_check" CHECK (not "meeting_topics"."is_finance_topic" or ("meeting_topics"."parent_id" is null and "meeting_topics"."meeting_id" is not null and not "meeting_topics"."is_finance_item"));