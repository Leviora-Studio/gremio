DROP INDEX "meeting_topics_finance_root_uq";--> statement-breakpoint
DROP INDEX "meeting_topics_finance_card_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_topics_finance_root_uq" ON "meeting_topics" USING btree ("meeting_id") WHERE "meeting_topics"."is_finance_topic" = true and "meeting_topics"."transferred" = false;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_topics_finance_card_uq" ON "meeting_topics" USING btree ("meeting_id","finance_card_id") WHERE "meeting_topics"."transferred" = false;