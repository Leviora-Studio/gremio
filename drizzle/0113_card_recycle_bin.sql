-- Preserve every existing card and child row. Cards retain their identity in the board bin.
ALTER TABLE cards ADD COLUMN deleted_at timestamptz;
ALTER TABLE trash_entries DROP CONSTRAINT trash_entries_kind_check;
ALTER TABLE trash_entries ADD CONSTRAINT trash_entries_kind_check CHECK(kind in ('board','finance','inventory','cashbook','group','account','priority','location','feedback','board_template','finance_template','meeting_template','meeting','topic','attachment','meeting_area','card'));
CREATE INDEX trash_card_board ON trash_entries ((context->>'boardId'),deleted_at) WHERE kind='card' AND state in ('trashed','purging');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trash_kind_table(kind text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE kind
 WHEN 'card' THEN 'cards'
 WHEN 'board' THEN 'boards'
 WHEN 'finance' THEN 'finance_boards'
 WHEN 'inventory' THEN 'inventory_boards'
 WHEN 'cashbook' THEN 'cashbooks'
 WHEN 'group' THEN 'groups'
 WHEN 'account' THEN 'accounts'
 WHEN 'priority' THEN 'priorities'
 WHEN 'location' THEN 'locations'
 WHEN 'feedback' THEN 'feedback_areas'
 WHEN 'board_template' THEN 'board_templates'
 WHEN 'finance_template' THEN 'finance_templates'
 WHEN 'meeting_template' THEN 'meeting_area_templates'
 WHEN 'meeting_area' THEN 'meeting_areas'
 WHEN 'meeting' THEN 'meetings'
 WHEN 'topic' THEN 'meeting_topics'
 END $$;
CREATE OR REPLACE FUNCTION trash_live_card(id integer) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT c.deleted_at IS NULL AND trash_live_board(c.board_id) FROM cards c WHERE c.id=$1 $$;
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON cards FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();

--> statement-breakpoint
CREATE OR REPLACE FUNCTION nextcloud_archive_eligible(card integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS (
  SELECT 1 FROM cards c
  JOIN boards b ON b.id=c.board_id
  JOIN board_statuses s ON s.id=c.status_id AND s.board_id=b.id
  JOIN board_archive a ON a.board_id=b.id
  WHERE c.id=$1 AND c.deleted_at IS NULL AND c.nextcloud_link IS NULL
   AND b.deleted_at IS NULL AND b.inventory_board_id IS NULL
   AND c.public_status_id=c.status_id AND s.is_archive_trigger
   AND (NOT b.is_application_board OR NOT s.is_lock_column OR c.locked_at IS NOT NULL)
   AND a.enabled AND nullif(a.nc_url,'') IS NOT NULL
   AND nullif(a.nc_username,'') IS NOT NULL AND nullif(a.nc_password_enc,'') IS NOT NULL
   AND nullif(a.target_folder,'') IS NOT NULL
 )
$$;
CREATE TRIGGER nextcloud_archive_card_restore AFTER UPDATE OF deleted_at ON cards FOR EACH ROW EXECUTE FUNCTION queue_nextcloud_card_change();
