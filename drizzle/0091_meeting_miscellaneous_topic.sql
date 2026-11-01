ALTER TABLE meeting_areas ADD COLUMN include_miscellaneous boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE meeting_topics ADD COLUMN is_miscellaneous boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE meeting_topics ADD CONSTRAINT meeting_topics_miscellaneous_check CHECK (NOT is_miscellaneous OR (meeting_id IS NOT NULL AND parent_id IS NULL AND section='public' AND NOT is_finance_topic AND NOT is_finance_item));
--> statement-breakpoint
CREATE UNIQUE INDEX meeting_topics_miscellaneous_uq ON meeting_topics(meeting_id) WHERE is_miscellaneous=true;
