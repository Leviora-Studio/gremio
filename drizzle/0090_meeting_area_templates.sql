CREATE TABLE meeting_area_templates (
  id serial PRIMARY KEY, name text NOT NULL UNIQUE, description text NOT NULL DEFAULT '',
  topics jsonb NOT NULL DEFAULT '[]'::jsonb, revision integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE meeting_areas ADD COLUMN default_topics jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE meeting_areas ADD COLUMN default_topics_revision integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE meeting_areas ADD COLUMN default_topics_template_id integer REFERENCES meeting_area_templates(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE meeting_topics DROP CONSTRAINT meeting_topics_section_check;
--> statement-breakpoint
ALTER TABLE meeting_topics ADD CONSTRAINT meeting_topics_section_check CHECK(section IN ('opening','public','non_public'));
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON meeting_area_templates REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON meeting_area_templates REFERENCING OLD TABLE AS previous_rows NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON meeting_area_templates REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();

--> statement-breakpoint
ALTER TABLE meetings ADD COLUMN defaults_applied boolean NOT NULL DEFAULT false;
