-- Preserve existing areas and all their content; deletion uses the shared 30-day bin.
ALTER TABLE meeting_areas ADD COLUMN deleted_at timestamptz;
ALTER TABLE trash_entries DROP CONSTRAINT trash_entries_kind_check;
ALTER TABLE trash_entries ADD CONSTRAINT trash_entries_kind_check CHECK(kind in ('board','finance','inventory','cashbook','group','account','priority','location','feedback','board_template','finance_template','meeting_template','meeting','topic','attachment','meeting_area'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION trash_kind_table(kind text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE kind
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
CREATE OR REPLACE FUNCTION trash_purge_allows(relation_name text,old_row jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE entry trash_entries; parameter text;
BEGIN
 parameter:=current_setting('gremio.trash_purge',true);
 IF parameter IS NULL OR parameter !~ '^[0-9]+$' THEN RETURN false; END IF;
 SELECT * INTO entry FROM trash_entries WHERE id=parameter::integer AND state='trashed';
 IF NOT FOUND THEN RETURN false; END IF;
 IF old_row ? 'id' AND trash_scope_contains(entry,relation_name,(old_row->>'id')::integer) THEN RETURN true; END IF;
 IF old_row ? 'card_id' AND trash_scope_contains(entry,'cards',(old_row->>'card_id')::integer) THEN RETURN true; END IF;
 IF old_row ? 'cashbook_id' AND trash_scope_contains(entry,'cashbooks',(old_row->>'cashbook_id')::integer) THEN RETURN true; END IF;
 IF old_row ? 'board_id' AND (trash_scope_contains(entry,'boards',(old_row->>'board_id')::integer) OR relation_name LIKE 'inventory_%' AND trash_scope_contains(entry,'inventory_boards',(old_row->>'board_id')::integer)) THEN RETURN true; END IF;
 IF old_row ? 'item_id' AND trash_scope_contains(entry,'inventory_items',(old_row->>'item_id')::integer) THEN RETURN true; END IF;
 IF old_row ? 'group_id' AND trash_scope_contains(entry,'groups',(old_row->>'group_id')::integer) THEN RETURN true; END IF;
 IF old_row ? 'topic_id' AND trash_scope_contains(entry,'meeting_topics',(old_row->>'topic_id')::integer) THEN RETURN true; END IF;
 IF old_row ? 'area_id' AND trash_scope_contains(entry,'meeting_areas',(old_row->>'area_id')::integer) THEN RETURN true; END IF;
 IF old_row ? 'meeting_id' AND trash_scope_contains(entry,'meetings',(old_row->>'meeting_id')::integer) THEN RETURN true; END IF;
 RETURN false;
END $$;
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON meeting_areas FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
--> statement-breakpoint
CREATE FUNCTION trash_live_meeting(id integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT m.deleted_at IS NULL AND a.deleted_at IS NULL FROM meetings m JOIN meeting_areas a ON a.id=m.area_id WHERE m.id=$1
$$;
CREATE OR REPLACE FUNCTION trash_live_topic(id integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT t.deleted_at IS NULL AND (t.meeting_id IS NULL OR coalesce(trash_live_meeting(t.meeting_id),false)) FROM meeting_topics t WHERE t.id=$1
$$;
CREATE OR REPLACE FUNCTION enforce_trash_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_data jsonb; active boolean:=true;
BEGIN
 IF TG_OP='DELETE' THEN row_data:=to_jsonb(OLD); ELSE row_data:=to_jsonb(NEW); END IF;
 IF TG_OP='DELETE' AND trash_purge_allows(TG_TABLE_NAME,row_data) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND trash_fk_cleanup_allows(TG_TABLE_NAME,to_jsonb(OLD),row_data) THEN RETURN NEW; END IF;
 CASE TG_ARGV[0]
 WHEN 'board' THEN active:=trash_live_board((row_data->>'board_id')::integer);
 WHEN 'card' THEN active:=trash_live_card((row_data->>'card_id')::integer);
 WHEN 'inventory' THEN SELECT deleted_at IS NULL INTO active FROM inventory_boards WHERE id=(row_data->>'board_id')::integer;
 WHEN 'item' THEN active:=trash_live_item((row_data->>'item_id')::integer);
 WHEN 'cashbook' THEN SELECT deleted_at IS NULL INTO active FROM cashbooks WHERE id=(row_data->>'cashbook_id')::integer;
 WHEN 'finance' THEN SELECT deleted_at IS NULL INTO active FROM finance_boards WHERE id=(row_data->>'finance_board_id')::integer;
 WHEN 'meeting_area' THEN SELECT deleted_at IS NULL INTO active FROM meeting_areas WHERE id=(row_data->>'area_id')::integer FOR SHARE;
 WHEN 'meeting' THEN IF row_data->>'meeting_id' IS NOT NULL THEN active:=trash_live_meeting((row_data->>'meeting_id')::integer); END IF;
 WHEN 'topic' THEN active:=trash_live_topic((row_data->>'topic_id')::integer);
 WHEN 'group' THEN SELECT deleted_at IS NULL INTO active FROM groups WHERE id=(row_data->>'group_id')::integer;
 WHEN 'board_template' THEN SELECT deleted_at IS NULL INTO active FROM board_templates WHERE id=(row_data->>'template_id')::integer;
 WHEN 'finance_template' THEN SELECT deleted_at IS NULL INTO active FROM finance_templates WHERE id=(row_data->>'template_id')::integer;
 END CASE;
 IF TG_OP='DELETE' AND active IS NULL THEN RETURN OLD; END IF;
 IF active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Die zugehörige Ressource liegt im Papierkorb oder ist nicht verfügbar.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON meetings FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('meeting_area');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON meeting_area_access FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('meeting_area');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON meeting_boards FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('meeting');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON meeting_topic_activity FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('topic');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON meeting_topic_cards FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('topic');
