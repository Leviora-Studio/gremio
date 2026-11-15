-- Permit only technical Nextcloud bookkeeping after an irreversible card lock.
-- Card contents and the lock itself remain frozen. A recorded archive link is
-- append-only on locked cards and cannot be replaced or cleared afterwards.
CREATE OR REPLACE FUNCTION enforce_card_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.locked_at IS NOT NULL THEN RAISE EXCEPTION 'Diese Karte ist dauerhaft gesperrt.' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.locked_at IS NOT NULL THEN
  IF (to_jsonb(NEW)-ARRAY['status_id','position','updated_at','done_since','public_status_id','nextcloud_link','archive_pending','archive_first_failed_at','archive_last_attempt_at','archive_last_error']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status_id','position','updated_at','done_since','public_status_id','nextcloud_link','archive_pending','archive_first_failed_at','archive_last_attempt_at','archive_last_error']) THEN
   RAISE EXCEPTION 'Diese Karte ist dauerhaft gesperrt.' USING ERRCODE='23514';
  END IF;
  IF OLD.nextcloud_link IS NOT NULL AND NEW.nextcloud_link IS DISTINCT FROM OLD.nextcloud_link THEN
   RAISE EXCEPTION 'Der Archivverweis einer gesperrten Karte ist unveränderlich.' USING ERRCODE='23514';
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
