ALTER TABLE cashbook_entries ADD COLUMN flagged_at timestamptz;
ALTER TABLE cashbook_entries ADD COLUMN flagged_by integer REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE cashbook_entries ADD COLUMN flag_reason text;
ALTER TABLE cashbook_entries ADD CONSTRAINT cashbook_emergency_flag_consistent CHECK (
 (flagged_at IS NULL AND flagged_by IS NULL AND flag_reason IS NULL) OR
 (flagged_at IS NOT NULL AND flagged_by IS NOT NULL AND state='posted' AND corrects_id IS NULL AND (flag_reason IS NULL OR length(flag_reason)<=4000))
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cashbook_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Kassenbuchdaten dürfen nicht gelöscht werden.'; END IF;
 IF TG_TABLE_NAME='cashbook_activity' THEN RAISE EXCEPTION 'Der Kassenbuchverlauf ist unveränderlich.'; END IF;
 IF OLD.state='posted' THEN
  IF (to_jsonb(NEW)-ARRAY['office_done','booking_date','revision','flagged_at','flagged_by','flag_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['office_done','booking_date','revision','flagged_at','flagged_by','flag_reason']) OR (OLD.booking_date IS NOT NULL AND NEW.booking_date IS DISTINCT FROM OLD.booking_date) THEN RAISE EXCEPTION 'Gebuchte Werte sind unveränderlich. Bitte Korrekturbuchung anlegen.'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION cashbook_emergency_flag_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.flagged_at IS NOT NULL OR NEW.flagged_by IS NOT NULL OR NEW.flag_reason IS NOT NULL THEN RAISE EXCEPTION 'Die Notfallmarkierung ist nur für bereits erteilte, offene Anweisungen zulässig.'; END IF;
 ELSE
  IF OLD.flagged_at IS NOT NULL AND (NEW.flagged_at,NEW.flagged_by,NEW.flag_reason) IS DISTINCT FROM (OLD.flagged_at,OLD.flagged_by,OLD.flag_reason) THEN RAISE EXCEPTION 'Eine Notfallmarkierung bleibt unveränderlich erhalten.'; END IF;
  IF OLD.flagged_at IS NULL AND NEW.flagged_at IS NOT NULL THEN
   IF OLD.state<>'posted' OR NEW.state<>'posted' OR OLD.corrects_id IS NOT NULL OR OLD.office_done OR NEW.office_done THEN RAISE EXCEPTION 'Nur noch offene Originalanweisungen dürfen als falsch markiert werden.'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cashbook_emergency_flag_guard BEFORE INSERT OR UPDATE ON cashbook_entries FOR EACH ROW EXECUTE FUNCTION cashbook_emergency_flag_guard();
