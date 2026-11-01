ALTER TABLE meeting_areas ADD COLUMN public_numbering text NOT NULL DEFAULT 'arabic' CHECK (public_numbering IN ('arabic','roman'));
--> statement-breakpoint
ALTER TABLE meeting_areas ADD COLUMN non_public_numbering text NOT NULL DEFAULT 'roman' CHECK (non_public_numbering IN ('arabic','roman'));
--> statement-breakpoint
ALTER TABLE meeting_areas ADD COLUMN first_section text NOT NULL DEFAULT 'public' CHECK (first_section IN ('public','non_public'));
--> statement-breakpoint
ALTER TABLE meeting_topics ADD COLUMN section text NOT NULL DEFAULT 'public' CHECK (section IN ('public','non_public'));
--> statement-breakpoint
CREATE FUNCTION inherit_meeting_topic_section() RETURNS trigger LANGUAGE plpgsql AS $section$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    SELECT section INTO NEW.section FROM meeting_topics WHERE id=NEW.parent_id;
  END IF;
  RETURN NEW;
END;
$section$;
--> statement-breakpoint
CREATE TRIGGER meeting_topic_section_inherit BEFORE INSERT OR UPDATE OF parent_id,section ON meeting_topics FOR EACH ROW EXECUTE FUNCTION inherit_meeting_topic_section();
--> statement-breakpoint
CREATE FUNCTION propagate_meeting_topic_section() RETURNS trigger LANGUAGE plpgsql AS $section$
BEGIN
  IF OLD.section IS DISTINCT FROM NEW.section THEN
    UPDATE meeting_topics SET section=NEW.section WHERE parent_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$section$;
--> statement-breakpoint
CREATE TRIGGER meeting_topic_section_propagate AFTER UPDATE OF section ON meeting_topics FOR EACH ROW EXECUTE FUNCTION propagate_meeting_topic_section();
