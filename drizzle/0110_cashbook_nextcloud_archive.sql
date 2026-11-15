-- Optional, owner-managed credentials stay separate from the general JSON config.
CREATE TABLE cashbook_archive (
 cashbook_id integer PRIMARY KEY REFERENCES cashbooks(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,
 nc_url text,nc_username text,nc_password_enc text,target_folder text,
 revision integer NOT NULL DEFAULT 0
);
CREATE TABLE cashbook_archive_jobs (
 entry_id integer PRIMARY KEY REFERENCES cashbook_entries(id) ON DELETE CASCADE,
 cashbook_id integer NOT NULL REFERENCES cashbooks(id) ON DELETE CASCADE,
 requested_by integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 requested_at timestamptz NOT NULL DEFAULT now(),attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_attempt_at timestamptz,last_error text,archived_at timestamptz,archive_path text,
 CHECK ((archived_at IS NULL)=(archive_path IS NULL))
);
CREATE INDEX cashbook_archive_jobs_pending ON cashbook_archive_jobs(requested_at,entry_id) WHERE archived_at IS NULL;
--> statement-breakpoint
CREATE FUNCTION queue_cashbook_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state<>'posted' AND NEW.state='posted' AND NEW.corrects_id IS NULL
  AND NEW.booking_number IS NOT NULL AND NEW.authorized_at IS NOT NULL
  AND NEW.first_signed_at IS NOT NULL AND NEW.second_signed_at IS NOT NULL AND NEW.second_signer_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM cashbooks b JOIN cashbook_archive a ON a.cashbook_id=b.id
   WHERE b.id=NEW.cashbook_id AND b.deleted_at IS NULL AND a.enabled
    AND nullif(a.nc_url,'') IS NOT NULL AND nullif(a.nc_username,'') IS NOT NULL
    AND nullif(a.nc_password_enc,'') IS NOT NULL AND nullif(a.target_folder,'') IS NOT NULL) THEN
  INSERT INTO cashbook_archive_jobs(entry_id,cashbook_id,requested_by)
  VALUES(NEW.id,NEW.cashbook_id,NEW.second_signer_id) ON CONFLICT(entry_id) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
-- Booking number assignment runs BEFORE this AFTER trigger. No old entries or
-- correction INSERTs are backfilled; only an instruction being authorized queues.
CREATE TRIGGER cashbook_archive_outbox AFTER UPDATE OF state ON cashbook_entries
 FOR EACH ROW EXECUTE FUNCTION queue_cashbook_archive();
CREATE FUNCTION guard_cashbook_archive_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF trash_purge_allows(TG_TABLE_NAME,to_jsonb(OLD)) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Archivaufträge dürfen nur mit dem gesamten Kassenbuch gelöscht werden.';
 END IF;
 IF NEW.entry_id<>OLD.entry_id OR NEW.cashbook_id<>OLD.cashbook_id OR NEW.requested_by<>OLD.requested_by OR NEW.requested_at<>OLD.requested_at OR (OLD.archived_at IS NOT NULL AND NEW IS DISTINCT FROM OLD) THEN
  RAISE EXCEPTION 'Die Zuordnung und ein erfolgreicher Archivvermerk sind unveränderlich.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cashbook_archive_job_guard BEFORE UPDATE OR DELETE ON cashbook_archive_jobs
 FOR EACH ROW EXECUTE FUNCTION guard_cashbook_archive_job();
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON cashbook_archive FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('cashbook');
--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON cashbook_archive REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_update AFTER UPDATE ON cashbook_archive REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_insert AFTER INSERT ON cashbook_archive_jobs REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_update AFTER UPDATE ON cashbook_archive_jobs REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
