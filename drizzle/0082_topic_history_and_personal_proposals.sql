ALTER TABLE "meeting_topics" ADD COLUMN "origin_topic_id" integer;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD COLUMN "previous_topic_id" integer;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD COLUMN "transferred" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD COLUMN "hidden_after_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_origin_topic_id_meeting_topics_id_fk" FOREIGN KEY ("origin_topic_id") REFERENCES "public"."meeting_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_previous_topic_id_meeting_topics_id_fk" FOREIGN KEY ("previous_topic_id") REFERENCES "public"."meeting_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_topics_origin_idx" ON "meeting_topics" USING btree ("origin_topic_id");--> statement-breakpoint
CREATE INDEX "meeting_topics_previous_idx" ON "meeting_topics" USING btree ("previous_topic_id");