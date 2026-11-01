ALTER TABLE meeting_areas ADD COLUMN word_template_path text;
--> statement-breakpoint
ALTER TABLE meeting_areas ADD COLUMN word_template_name text;
--> statement-breakpoint
ALTER TABLE meeting_areas ADD COLUMN word_template_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE meeting_areas ADD COLUMN word_configuration jsonb;
