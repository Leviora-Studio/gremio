CREATE TABLE "meeting_topic_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"origin_topic_id" integer NOT NULL,
	"topic_id" integer,
	"state" text NOT NULL,
	"baseline" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	CONSTRAINT "meeting_topic_activity_state_check" CHECK ("meeting_topic_activity"."state" in ('proposed','scheduled','treated','deferred','withdrawn'))
);
--> statement-breakpoint
ALTER TABLE "meeting_topic_activity" ADD CONSTRAINT "meeting_topic_activity_origin_topic_id_meeting_topics_id_fk" FOREIGN KEY ("origin_topic_id") REFERENCES "public"."meeting_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topic_activity" ADD CONSTRAINT "meeting_topic_activity_topic_id_meeting_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."meeting_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_topic_activity_origin_order_idx" ON "meeting_topic_activity" USING btree ("origin_topic_id","occurred_at","id");--> statement-breakpoint
-- Preserve only the existing known state. Earlier transitions cannot be reconstructed.
INSERT INTO meeting_topic_activity (origin_topic_id, topic_id, state, baseline)
SELECT origin_topic_id, id, state, true FROM meeting_topics
WHERE origin_topic_id IS NOT NULL AND meeting_id IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION record_personal_topic_activity() RETURNS trigger AS $$
BEGIN
  IF NEW.origin_topic_id IS NULL OR NEW.meeting_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state IS NOT DISTINCT FROM NEW.state
      AND OLD.meeting_id IS NOT DISTINCT FROM NEW.meeting_id
      AND OLD.origin_topic_id IS NOT DISTINCT FROM NEW.origin_topic_id THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO meeting_topic_activity (origin_topic_id, topic_id, state)
    VALUES (NEW.origin_topic_id, NEW.id, NEW.state);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER personal_topic_activity_insert AFTER INSERT ON meeting_topics
FOR EACH ROW EXECUTE FUNCTION record_personal_topic_activity();
--> statement-breakpoint
CREATE TRIGGER personal_topic_activity_update AFTER UPDATE OF state, meeting_id, origin_topic_id ON meeting_topics
FOR EACH ROW EXECUTE FUNCTION record_personal_topic_activity();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON meeting_topic_activity REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_update AFTER UPDATE ON meeting_topic_activity REFERENCING NEW TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
--> statement-breakpoint
CREATE TRIGGER app_change_delete AFTER DELETE ON meeting_topic_activity REFERENCING OLD TABLE AS changed_rows
FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
