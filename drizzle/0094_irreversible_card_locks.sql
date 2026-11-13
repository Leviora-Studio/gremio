ALTER TABLE boards ADD COLUMN completed_status_id integer REFERENCES board_statuses(id) ON DELETE SET NULL;
ALTER TABLE board_statuses ADD COLUMN is_lock_column boolean NOT NULL DEFAULT false;
ALTER TABLE cards ADD COLUMN locked_at timestamptz;
ALTER TABLE cards ADD COLUMN locked_by integer REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE cards ADD COLUMN public_status_id integer REFERENCES board_statuses(id) ON DELETE RESTRICT;
UPDATE cards SET public_status_id=status_id;
--> statement-breakpoint
CREATE FUNCTION enforce_card_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.locked_at IS NOT NULL THEN RAISE EXCEPTION 'Diese Karte ist dauerhaft gesperrt.' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.locked_at IS NOT NULL THEN
  IF (to_jsonb(NEW)-ARRAY['status_id','position','updated_at','done_since','public_status_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status_id','position','updated_at','done_since','public_status_id']) THEN
   RAISE EXCEPTION 'Diese Karte ist dauerhaft gesperrt.' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.locked_at IS NOT NULL THEN
  NEW.public_status_id:=NEW.status_id;
 ELSIF EXISTS(SELECT 1 FROM board_statuses s JOIN boards b ON b.id=s.board_id WHERE s.id=NEW.status_id AND s.is_lock_column AND b.is_application_board) THEN
  IF TG_OP='INSERT' THEN NEW.public_status_id:=NULL;
  ELSE NEW.public_status_id:=OLD.public_status_id; END IF;
 ELSE NEW.public_status_id:=NEW.status_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cards_freeze BEFORE INSERT OR UPDATE OR DELETE ON cards FOR EACH ROW EXECUTE FUNCTION enforce_card_freeze();
--> statement-breakpoint
CREATE FUNCTION enforce_frozen_card_child() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id integer; frozen timestamptz;
BEGIN
 IF TG_OP='DELETE' THEN parent_id:=OLD.card_id; ELSE parent_id:=NEW.card_id; END IF;
 SELECT locked_at INTO frozen FROM cards WHERE id=parent_id FOR UPDATE;
 IF frozen IS NOT NULL THEN
  IF TG_TABLE_NAME='attachments' AND TG_OP='INSERT' THEN
   IF NEW.kind='other' AND NEW.upload_purpose='receipt' THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Diese Karte ist dauerhaft gesperrt. Nur neue Quittungen sind zulässig.' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND NEW.card_id<>OLD.card_id THEN
  IF EXISTS(SELECT 1 FROM cards WHERE id=OLD.card_id AND locked_at IS NOT NULL) THEN RAISE EXCEPTION 'Diese Karte ist dauerhaft gesperrt.'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attachments_card_freeze BEFORE INSERT OR UPDATE OR DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION enforce_frozen_card_child();
CREATE TRIGGER card_assignees_freeze BEFORE INSERT OR UPDATE OR DELETE ON card_assignees FOR EACH ROW EXECUTE FUNCTION enforce_frozen_card_child();
CREATE TRIGGER card_comments_freeze BEFORE INSERT OR UPDATE OR DELETE ON card_comments FOR EACH ROW EXECUTE FUNCTION enforce_frozen_card_child();
CREATE TRIGGER card_budget_positions_freeze BEFORE INSERT OR UPDATE OR DELETE ON card_budget_positions FOR EACH ROW EXECUTE FUNCTION enforce_frozen_card_child();
CREATE TRIGGER card_budget_plans_freeze BEFORE INSERT OR UPDATE OR DELETE ON card_budget_plans FOR EACH ROW EXECUTE FUNCTION enforce_frozen_card_child();
CREATE TRIGGER attachment_folders_freeze BEFORE INSERT OR UPDATE OR DELETE ON attachment_folders FOR EACH ROW EXECUTE FUNCTION enforce_frozen_card_child();
