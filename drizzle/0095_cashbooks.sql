CREATE TABLE cashbooks(id serial PRIMARY KEY,name text NOT NULL,owner_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,config jsonb NOT NULL,revision integer NOT NULL DEFAULT 0,next_number integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE cashbook_access(id serial PRIMARY KEY,cashbook_id integer NOT NULL REFERENCES cashbooks(id) ON DELETE RESTRICT,user_id integer REFERENCES users(id) ON DELETE RESTRICT,group_id integer REFERENCES groups(id) ON DELETE RESTRICT,access_level text NOT NULL CHECK(access_level IN ('read','write')),CHECK((user_id IS NULL)<>(group_id IS NULL)));
CREATE UNIQUE INDEX cashbook_access_user ON cashbook_access(cashbook_id,user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX cashbook_access_group ON cashbook_access(cashbook_id,group_id) WHERE group_id IS NOT NULL;
CREATE TABLE cashbook_entries(id serial PRIMARY KEY,cashbook_id integer NOT NULL REFERENCES cashbooks(id) ON DELETE RESTRICT,creator_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','submitted','posted')),revision integer NOT NULL DEFAULT 0,data jsonb NOT NULL,role text NOT NULL CHECK(role IN ('speaker','finance')),second_signer_id integer REFERENCES users(id) ON DELETE RESTRICT,files jsonb NOT NULL DEFAULT '[]',first_signed_at timestamptz,second_signed_at timestamptz,authorized_at timestamptz,booking_date text,office_done boolean NOT NULL DEFAULT false,corrects_id integer REFERENCES cashbook_entries(id) ON DELETE RESTRICT,correction_reason text,created_at timestamptz NOT NULL DEFAULT now(),CHECK(second_signer_id IS NULL OR second_signer_id<>creator_id),CHECK(state<>'posted' OR authorized_at IS NOT NULL),CHECK(corrects_id IS NULL OR length(trim(correction_reason))>0));
CREATE UNIQUE INDEX cashbook_one_correction ON cashbook_entries(corrects_id) WHERE corrects_id IS NOT NULL;
CREATE INDEX cashbook_entries_book ON cashbook_entries(cashbook_id,state);
CREATE TABLE cashbook_activity(id serial PRIMARY KEY,cashbook_id integer NOT NULL REFERENCES cashbooks(id) ON DELETE RESTRICT,entry_id integer REFERENCES cashbook_entries(id) ON DELETE RESTRICT,user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,type text NOT NULL,detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE finance_boards ADD COLUMN cashbook_id integer REFERENCES cashbooks(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION cashbook_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Kassenbuchdaten dürfen nicht gelöscht werden.'; END IF;
 IF TG_TABLE_NAME='cashbook_activity' THEN RAISE EXCEPTION 'Der Kassenbuchverlauf ist unveränderlich.'; END IF;
 IF OLD.state='posted' THEN
  IF (to_jsonb(NEW)-ARRAY['office_done','booking_date','revision']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['office_done','booking_date','revision']) OR (OLD.booking_date IS NOT NULL AND NEW.booking_date IS DISTINCT FROM OLD.booking_date) THEN RAISE EXCEPTION 'Gebuchte Werte sind unveränderlich. Bitte Korrekturbuchung anlegen.'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cashbook_entries_immutable BEFORE UPDATE OR DELETE ON cashbook_entries FOR EACH ROW EXECUTE FUNCTION cashbook_immutable();
CREATE TRIGGER cashbook_activity_immutable BEFORE UPDATE OR DELETE ON cashbook_activity FOR EACH ROW EXECUTE FUNCTION cashbook_immutable();
--> statement-breakpoint
ALTER TABLE finance_board_sources ADD COLUMN account_id integer REFERENCES accounts(id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE FUNCTION cashbook_submitted_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='submitted' THEN
  IF (to_jsonb(NEW)-ARRAY['state','revision','files','first_signed_at','second_signed_at','authorized_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','files','first_signed_at','second_signed_at','authorized_at']) THEN RAISE EXCEPTION 'Vorgelegte Vorgänge sind bis zur begründeten Rückgabe gesperrt.'; END IF;
 END IF;
 IF OLD.state='submitted' AND NEW.state<>'posted' AND NEW.authorized_at IS DISTINCT FROM OLD.authorized_at THEN RAISE EXCEPTION 'Der Anweisungszeitpunkt wird erst beim Buchen gesetzt.'; END IF;
 IF NEW.state='submitted' AND (NEW.first_signed_at IS NULL OR NEW.second_signer_id IS NULL) THEN RAISE EXCEPTION 'Vorlegen erfordert erste Unterschrift und zweite Person.'; END IF;
 IF OLD.state='submitted' AND NEW.state='posted' AND (NEW.first_signed_at IS NULL OR NEW.second_signed_at IS NULL) THEN RAISE EXCEPTION 'Anweisen erfordert beide Unterschriften.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cashbook_submitted_freeze BEFORE UPDATE ON cashbook_entries FOR EACH ROW EXECUTE FUNCTION cashbook_submitted_freeze();
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON cashbooks REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_update AFTER UPDATE ON cashbooks REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_insert AFTER INSERT ON cashbook_access REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_update AFTER UPDATE ON cashbook_access REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_delete AFTER DELETE ON cashbook_access REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_insert AFTER INSERT ON cashbook_entries REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_update AFTER UPDATE ON cashbook_entries REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_insert AFTER INSERT ON cashbook_activity REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
