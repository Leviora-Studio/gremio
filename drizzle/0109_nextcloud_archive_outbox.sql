-- One durable pending job per card. Delivery is at least once; successful card
-- bookkeeping and removal from this outbox are committed together.
CREATE TABLE nextcloud_archive_jobs (
 card_id integer PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
 requested_at timestamptz NOT NULL DEFAULT now(),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 last_attempt_at timestamptz,
 last_error text
);
CREATE INDEX nextcloud_archive_jobs_order ON nextcloud_archive_jobs(requested_at,card_id);
--> statement-breakpoint
CREATE FUNCTION nextcloud_archive_eligible(card integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM cards c
  JOIN boards b ON b.id=c.board_id
  JOIN board_statuses s ON s.id=c.status_id AND s.board_id=b.id
  JOIN board_archive a ON a.board_id=b.id
  WHERE c.id=$1 AND c.nextcloud_link IS NULL
   AND b.deleted_at IS NULL AND b.inventory_board_id IS NULL
   AND c.public_status_id=c.status_id AND s.is_archive_trigger
   AND (NOT b.is_application_board OR NOT s.is_lock_column OR c.locked_at IS NOT NULL)
   AND a.enabled AND nullif(a.nc_url,'') IS NOT NULL
   AND nullif(a.nc_username,'') IS NOT NULL AND nullif(a.nc_password_enc,'') IS NOT NULL
   AND nullif(a.target_folder,'') IS NOT NULL
 )
$$;
CREATE FUNCTION queue_nextcloud_archive(card integer) RETURNS void LANGUAGE sql AS $$
 INSERT INTO nextcloud_archive_jobs(card_id)
 SELECT $1 WHERE nextcloud_archive_eligible($1)
 ON CONFLICT(card_id) DO NOTHING
$$;
CREATE FUNCTION queue_nextcloud_card_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM queue_nextcloud_archive(NEW.id);
 RETURN NEW;
END $$;
-- AFTER sees the status published by the irreversible-freeze BEFORE trigger.
CREATE TRIGGER nextcloud_archive_outbox AFTER INSERT OR UPDATE OF status_id,public_status_id,locked_at ON cards
 FOR EACH ROW EXECUTE FUNCTION queue_nextcloud_card_change();
--> statement-breakpoint
CREATE FUNCTION queue_nextcloud_board_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_board integer; card record;
BEGIN
 IF TG_TABLE_NAME='boards' THEN target_board:=NEW.id; ELSE target_board:=NEW.board_id; END IF;
 FOR card IN SELECT id FROM cards WHERE board_id=target_board AND nextcloud_link IS NULL LOOP
  PERFORM queue_nextcloud_archive(card.id);
 END LOOP;
 RETURN NEW;
END $$;
-- Configuration activation/changes and restoration also survive a process exit.
CREATE TRIGGER nextcloud_archive_config_outbox AFTER INSERT OR UPDATE ON board_archive
 FOR EACH ROW EXECUTE FUNCTION queue_nextcloud_board_change();
CREATE TRIGGER nextcloud_archive_status_outbox AFTER UPDATE OF is_archive_trigger,is_lock_column ON board_statuses
 FOR EACH ROW EXECUTE FUNCTION queue_nextcloud_board_change();
CREATE TRIGGER nextcloud_archive_board_outbox AFTER UPDATE OF deleted_at,is_application_board,inventory_board_id ON boards
 FOR EACH ROW EXECUTE FUNCTION queue_nextcloud_board_change();
--> statement-breakpoint
-- Recover previously missed eligible cards without rewriting any card content,
-- freeze, archive flag, stored link, activity or attachment metadata.
INSERT INTO nextcloud_archive_jobs(card_id)
SELECT id FROM cards WHERE nextcloud_archive_eligible(id)
ON CONFLICT(card_id) DO NOTHING;
