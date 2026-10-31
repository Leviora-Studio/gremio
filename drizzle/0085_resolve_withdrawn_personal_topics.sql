ALTER TABLE "meeting_topic_activity" DROP CONSTRAINT "meeting_topic_activity_state_check";--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meeting_topic_activity" ADD CONSTRAINT "meeting_topic_activity_state_check" CHECK ("meeting_topic_activity"."state" in ('proposed','scheduled','treated','deferred','withdrawn','resolved'));--> statement-breakpoint
-- Linking a legacy direct submission imports its known state, not a fictitious new withdrawal.
CREATE OR REPLACE FUNCTION record_personal_topic_activity() RETURNS trigger AS $$
DECLARE imported boolean := false;
BEGIN
  IF NEW.origin_topic_id IS NULL OR NEW.meeting_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.state IS NOT DISTINCT FROM NEW.state
      AND OLD.meeting_id IS NOT DISTINCT FROM NEW.meeting_id
      AND OLD.origin_topic_id IS NOT DISTINCT FROM NEW.origin_topic_id THEN RETURN NEW; END IF;
    imported := OLD.origin_topic_id IS NULL AND OLD.state IS NOT DISTINCT FROM NEW.state;
  END IF;
  INSERT INTO meeting_topic_activity (origin_topic_id, topic_id, state, baseline)
    VALUES (NEW.origin_topic_id, NEW.id, NEW.state, imported);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
