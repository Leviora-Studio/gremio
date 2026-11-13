ALTER TABLE cashbook_entries ADD COLUMN flag_resolved_at timestamptz;
ALTER TABLE cashbook_entries ADD COLUMN flag_resolved_by integer REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE cashbook_entries ADD CONSTRAINT cashbook_flag_resolution_consistent CHECK (
 (flag_resolved_at IS NULL AND flag_resolved_by IS NULL) OR
 (flag_resolved_at IS NOT NULL AND flag_resolved_by IS NOT NULL AND flagged_at IS NOT NULL AND flag_resolved_at >= flagged_at)
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cashbook_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Kassenbuchdaten dürfen nicht gelöscht werden.'; END IF;
 IF TG_TABLE_NAME='cashbook_activity' THEN RAISE EXCEPTION 'Der Kassenbuchverlauf ist unveränderlich.'; END IF;
 IF OLD.state='posted' THEN
  IF (to_jsonb(NEW)-ARRAY['office_done','booking_date','revision','flagged_at','flagged_by','flag_reason','flag_resolved_at','flag_resolved_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['office_done','booking_date','revision','flagged_at','flagged_by','flag_reason','flag_resolved_at','flag_resolved_by']) OR (OLD.booking_date IS NOT NULL AND NEW.booking_date IS DISTINCT FROM OLD.booking_date) THEN RAISE EXCEPTION 'Gebuchte Werte sind unveränderlich. Bitte Korrekturbuchung anlegen.'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION cashbook_flag_resolution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.flag_resolved_at IS NOT NULL OR NEW.flag_resolved_by IS NOT NULL THEN RAISE EXCEPTION 'Nur eine bestehende Rücksprache kann geklärt werden.'; END IF;
 ELSE
  IF OLD.flag_resolved_at IS NOT NULL AND (NEW.flag_resolved_at,NEW.flag_resolved_by) IS DISTINCT FROM (OLD.flag_resolved_at,OLD.flag_resolved_by) THEN RAISE EXCEPTION 'Eine geklärte Rücksprache bleibt unveränderlich dokumentiert.'; END IF;
  IF OLD.flag_resolved_at IS NULL AND NEW.flag_resolved_at IS NOT NULL THEN
   IF OLD.flagged_at IS NULL OR OLD.state<>'posted' OR NEW.state<>'posted' OR OLD.corrects_id IS NOT NULL THEN RAISE EXCEPTION 'Nur die Rücksprache einer markierten Originalanweisung kann geklärt werden.'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cashbook_flag_resolution_guard BEFORE INSERT OR UPDATE ON cashbook_entries FOR EACH ROW EXECUTE FUNCTION cashbook_flag_resolution_guard();
