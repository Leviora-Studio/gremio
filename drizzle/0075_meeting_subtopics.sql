ALTER TABLE "meeting_topics" ADD COLUMN "parent_id" integer;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_parent_id_meeting_topics_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."meeting_topics"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION check_meeting_topic_parent() RETURNS trigger LANGUAGE plpgsql AS $hierarchy$
DECLARE parent_row meeting_topics%ROWTYPE;
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT * INTO parent_row FROM meeting_topics WHERE id=NEW.parent_id FOR UPDATE;
    IF NOT FOUND OR NEW.id=NEW.parent_id OR NEW.meeting_id IS NULL OR parent_row.meeting_id IS DISTINCT FROM NEW.meeting_id OR parent_row.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'invalid meeting topic parent' USING ERRCODE='23514';
    END IF;
    IF EXISTS(SELECT 1 FROM meeting_topics WHERE parent_id=NEW.id) THEN
      RAISE EXCEPTION 'only one subtopic level is supported' USING ERRCODE='23514';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM meeting_topics WHERE parent_id=NEW.id AND meeting_id IS DISTINCT FROM NEW.meeting_id) THEN
    RAISE EXCEPTION 'subtopics must stay in the same meeting' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$hierarchy$;
--> statement-breakpoint
CREATE TRIGGER meeting_topic_parent_guard BEFORE INSERT OR UPDATE OF parent_id,meeting_id ON meeting_topics FOR EACH ROW EXECUTE FUNCTION check_meeting_topic_parent();
--> statement-breakpoint
CREATE FUNCTION preserve_deleted_topic_privacy() RETURNS trigger LANGUAGE plpgsql AS $privacy$
BEGIN
  IF OLD.confidential AND EXISTS(SELECT 1 FROM meetings WHERE id=OLD.meeting_id) THEN UPDATE meeting_topics SET confidential=true WHERE parent_id=OLD.id; END IF;
  RETURN OLD;
END;
$privacy$;
--> statement-breakpoint
CREATE TRIGGER meeting_topic_delete_privacy BEFORE DELETE ON meeting_topics FOR EACH ROW EXECUTE FUNCTION preserve_deleted_topic_privacy();
