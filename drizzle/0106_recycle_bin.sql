-- Preserve all existing rows. Normal reads exclude rows in the recycle bin.
ALTER TABLE boards ADD COLUMN deleted_at timestamptz;
ALTER TABLE finance_boards ADD COLUMN deleted_at timestamptz;
ALTER TABLE inventory_boards ADD COLUMN deleted_at timestamptz;
ALTER TABLE cashbooks ADD COLUMN deleted_at timestamptz;
ALTER TABLE groups ADD COLUMN deleted_at timestamptz;
ALTER TABLE accounts ADD COLUMN deleted_at timestamptz;
ALTER TABLE priorities ADD COLUMN deleted_at timestamptz;
ALTER TABLE locations ADD COLUMN deleted_at timestamptz;
ALTER TABLE feedback_areas ADD COLUMN deleted_at timestamptz;
ALTER TABLE board_templates ADD COLUMN deleted_at timestamptz;
ALTER TABLE finance_templates ADD COLUMN deleted_at timestamptz;
ALTER TABLE meeting_area_templates ADD COLUMN deleted_at timestamptz;
ALTER TABLE meetings ADD COLUMN deleted_at timestamptz;
ALTER TABLE meeting_topics ADD COLUMN deleted_at timestamptz;
--> statement-breakpoint
CREATE TABLE trash_entries (
 id serial PRIMARY KEY,kind text NOT NULL CHECK(kind in ('board','finance','inventory','cashbook','group','account','priority','location','feedback','board_template','finance_template','meeting_template','meeting','topic')),
 entity_id integer NOT NULL,label text NOT NULL,deleted_by integer REFERENCES users(id) ON DELETE SET NULL,deleted_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'trashed' CHECK(state in ('trashed','purging','restored','purged')),context jsonb NOT NULL DEFAULT '{}',cleanup_paths jsonb NOT NULL DEFAULT '[]',last_error text,finished_at timestamptz,finished_by integer REFERENCES users(id) ON DELETE SET NULL,
 CHECK(expires_at>=deleted_at+interval '120 hours')
);
CREATE UNIQUE INDEX trash_active_entity ON trash_entries(kind,entity_id) WHERE state in ('trashed','purging');
CREATE INDEX trash_expiry ON trash_entries(expires_at) WHERE state in ('trashed','purging');
CREATE TABLE maintenance_runs(name text PRIMARY KEY,last_date text NOT NULL);
--> statement-breakpoint
CREATE FUNCTION trash_kind_table(kind text) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE kind
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
 WHEN 'meeting' THEN 'meetings'
 WHEN 'topic' THEN 'meeting_topics'
 END $$;
CREATE FUNCTION trash_scope_contains(entry trash_entries,relation_name text,entity_id integer) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT (trash_kind_table(entry.kind)=relation_name AND entry.entity_id=entity_id) OR coalesce((entry.context->'purgeScope'->relation_name) @> jsonb_build_array(entity_id),false)
$$;
CREATE FUNCTION trash_purge_allows(relation_name text,old_row jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
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
 RETURN false;
END $$;
-- Only actual ON DELETE SET NULL changes caused by the scoped whole-resource
-- purge may update an otherwise frozen/trashed referencing row.
CREATE FUNCTION trash_fk_cleanup_allows(relation_name text,old_row jsonb,new_row jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE entry trash_entries; parameter text; fk record; allowed_columns text[]:=ARRAY[]::text[];
BEGIN
 parameter:=current_setting('gremio.trash_purge',true);
 IF parameter IS NULL OR parameter !~ '^[0-9]+$' THEN RETURN false; END IF;
 SELECT * INTO entry FROM trash_entries WHERE id=parameter::integer AND state='trashed';
 IF NOT FOUND THEN RETURN false; END IF;
 FOR fk IN SELECT a.attname AS column_name,target.relname AS target_table FROM pg_constraint c JOIN pg_class target ON target.oid=c.confrelid JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1] WHERE c.conrelid=to_regclass(relation_name) AND c.contype='f' AND (c.confdeltype='n' OR (relation_name IN ('locations','feedback_areas') AND old_row->>'deleted_at' IS NOT NULL AND c.confdeltype='r')) AND cardinality(c.conkey)=1 LOOP
  IF old_row->>fk.column_name IS NOT NULL AND new_row->fk.column_name='null'::jsonb AND trash_scope_contains(entry,fk.target_table,(old_row->>fk.column_name)::integer) THEN allowed_columns:=array_append(allowed_columns,fk.column_name); END IF;
 END LOOP;
 IF relation_name='meeting_topics' AND old_row->>'parent_id' IS NOT NULL AND trash_scope_contains(entry,'meeting_topics',(old_row->>'parent_id')::integer) AND old_row->'confidential'='false'::jsonb AND new_row->'confidential'='true'::jsonb AND old_row-'confidential'=new_row-'confidential' THEN RETURN true; END IF;
 RETURN cardinality(allowed_columns)>0 AND (old_row-allowed_columns)=(new_row-allowed_columns);
END $$;
--> statement-breakpoint
-- Keep catalog links during the retention window; clear only after final purge.
DO $$ DECLARE relation_name text; constraint_name text;
BEGIN
 FOR relation_name,constraint_name IN SELECT c.conrelid::regclass::text,c.conname FROM pg_constraint c WHERE c.contype='f' AND ((c.conrelid IN ('accounts'::regclass,'cashbooks'::regclass) AND c.confrelid='finance_boards'::regclass) OR (c.conrelid='finance_boards'::regclass AND c.confrelid='cashbooks'::regclass)) LOOP
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',relation_name,constraint_name);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE SET NULL',relation_name,constraint_name,CASE WHEN relation_name='finance_boards' THEN 'cashbook_id' ELSE 'finance_board_id' END,CASE WHEN relation_name='finance_boards' THEN 'cashbooks' ELSE 'finance_boards' END);
 END LOOP;
END $$;
--> statement-breakpoint
-- Extend immutable-content triggers with one narrow, transaction-local exception
-- for the exact resource and descendants recorded in a trash purge. No triggers
-- are disabled, and normal content editing/deletion stays forbidden.
DO $$ DECLARE name text; definition text;
BEGIN
 FOREACH name IN ARRAY ARRAY['enforce_card_freeze','enforce_frozen_card_child','enforce_budget_plan_freeze','immutable_budget_plan_correction','cashbook_immutable'] LOOP
  SELECT pg_get_functiondef(to_regprocedure(name||'()')) INTO definition;
  definition:=regexp_replace(definition,'\mBEGIN\M',$guard$BEGIN
 IF TG_OP='DELETE' AND trash_purge_allows(TG_TABLE_NAME,to_jsonb(OLD)) THEN RETURN OLD; END IF;
 IF TG_OP='UPDATE' AND trash_fk_cleanup_allows(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;$guard$, 'i');
  EXECUTE definition;
 END LOOP;
END $$;
--> statement-breakpoint
CREATE FUNCTION enforce_trash_root() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry trash_entries; parameter text; matching boolean;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.deleted_at IS NOT NULL AND NOT trash_purge_allows(TG_TABLE_NAME,to_jsonb(OLD)) THEN RAISE EXCEPTION 'Dieser Eintrag liegt im Papierkorb. Bitte endgültig über den Papierkorb löschen.'; END IF;
  RETURN OLD;
 END IF;
 IF trash_fk_cleanup_allows(TG_TABLE_NAME,to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW; END IF;
 IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NULL THEN RETURN NEW; END IF;
 IF (to_jsonb(OLD)-'deleted_at') IS DISTINCT FROM (to_jsonb(NEW)-'deleted_at') THEN RAISE EXCEPTION 'Einträge im Papierkorb dürfen nicht verändert werden.'; END IF;
 parameter:=current_setting(CASE WHEN NEW.deleted_at IS NULL THEN 'gremio.trash_restore' ELSE 'gremio.trash_move' END,true);
 IF parameter IS NULL OR parameter !~ '^[0-9]+$' THEN RAISE EXCEPTION 'Papierkorb-Aktion erforderlich.'; END IF;
 SELECT * INTO entry FROM trash_entries WHERE id=parameter::integer AND state='trashed';
 matching:=FOUND AND ((trash_kind_table(entry.kind)=TG_TABLE_NAME AND entry.entity_id=OLD.id) OR (entry.kind='inventory' AND TG_TABLE_NAME='boards' AND (entry.context->'boards') @> jsonb_build_array(OLD.id)));
 IF NOT matching OR (NEW.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM entry.deleted_at) THEN RAISE EXCEPTION 'Ungültige Papierkorb-Aktion.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON boards FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON finance_boards FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON inventory_boards FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON cashbooks FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON groups FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON priorities FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON locations FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON feedback_areas FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON board_templates FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON finance_templates FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON meeting_area_templates FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON meetings FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
CREATE TRIGGER trash_root BEFORE UPDATE OR DELETE ON meeting_topics FOR EACH ROW EXECUTE FUNCTION enforce_trash_root();
--> statement-breakpoint
CREATE FUNCTION trash_live_board(id integer) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT b.deleted_at IS NULL AND (b.inventory_board_id IS NULL OR EXISTS(SELECT 1 FROM inventory_boards i WHERE i.id=b.inventory_board_id AND i.deleted_at IS NULL)) FROM boards b WHERE b.id=$1 $$;
CREATE FUNCTION trash_live_card(id integer) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT trash_live_board(c.board_id) FROM cards c WHERE c.id=$1 $$;
CREATE FUNCTION trash_live_item(id integer) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT b.deleted_at IS NULL FROM inventory_items i JOIN inventory_boards b ON b.id=i.board_id WHERE i.id=$1 $$;
CREATE FUNCTION trash_live_topic(id integer) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT t.deleted_at IS NULL AND (t.meeting_id IS NULL OR (m.id IS NOT NULL AND m.deleted_at IS NULL)) FROM meeting_topics t LEFT JOIN meetings m ON m.id=t.meeting_id WHERE t.id=$1 $$;
CREATE FUNCTION enforce_trash_parent() RETURNS trigger LANGUAGE plpgsql AS $$
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
 WHEN 'meeting' THEN IF row_data->>'meeting_id' IS NOT NULL THEN SELECT deleted_at IS NULL INTO active FROM meetings WHERE id=(row_data->>'meeting_id')::integer; END IF;
 WHEN 'topic' THEN active:=trash_live_topic((row_data->>'topic_id')::integer);
 WHEN 'group' THEN SELECT deleted_at IS NULL INTO active FROM groups WHERE id=(row_data->>'group_id')::integer;
 WHEN 'board_template' THEN SELECT deleted_at IS NULL INTO active FROM board_templates WHERE id=(row_data->>'template_id')::integer;
 WHEN 'finance_template' THEN SELECT deleted_at IS NULL INTO active FROM finance_templates WHERE id=(row_data->>'template_id')::integer;
 END CASE;
 IF TG_OP='DELETE' AND active IS NULL THEN RETURN OLD; END IF;
 IF active IS DISTINCT FROM true THEN RAISE EXCEPTION 'Die zugehörige Ressource liegt im Papierkorb oder ist nicht verfügbar.'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON cards FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('board');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON board_statuses FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('board');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON board_access FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('board');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON board_card_fields FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('board');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON board_office_roles FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('board');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON board_archive FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('board');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON board_instruction_forms FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('board');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON board_managers FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('board');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON attachments FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('card');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON attachment_folders FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('card');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON card_assignees FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('card');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON card_comments FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('card');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON card_activity FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('card');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON card_budget_plans FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('card');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON card_budget_positions FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('card');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON card_budget_plan_corrections FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('card');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON inventory_items FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('inventory');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON inventory_board_access FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('inventory');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON inventory_board_fields FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('inventory');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON inventory_board_managers FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('inventory');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON inventory_loans FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('item');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON inventory_attachments FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('item');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON cashbook_entries FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('cashbook');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON cashbook_activity FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('cashbook');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON cashbook_access FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('cashbook');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON finance_plan_items FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('finance');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON finance_board_access FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('finance');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON finance_board_accounts FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('finance');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON finance_board_expense_accounts FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('finance');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON finance_board_sources FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('finance');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON meeting_topics FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('meeting');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON meeting_documents FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('topic');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON user_groups FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('group');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON board_template_statuses FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('board_template');
CREATE TRIGGER trash_parent BEFORE INSERT OR UPDATE OR DELETE ON finance_template_items FOR EACH ROW EXECUTE FUNCTION enforce_trash_parent('finance_template');

--> statement-breakpoint
CREATE TRIGGER app_change_insert AFTER INSERT ON trash_entries REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();
CREATE TRIGGER app_change_update AFTER UPDATE ON trash_entries REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_app_change();

--> statement-breakpoint
-- Trashed finance TOPs reserve no active planning slot. Restore still checks
-- uniqueness, so a replacement is never overwritten.
DROP INDEX meeting_topics_finance_root_uq;
DROP INDEX meeting_topics_finance_card_uq;
CREATE UNIQUE INDEX meeting_topics_finance_root_uq ON meeting_topics(meeting_id) WHERE is_finance_topic=true AND transferred=false AND deleted_at IS NULL;
CREATE UNIQUE INDEX meeting_topics_finance_card_uq ON meeting_topics(meeting_id,finance_card_id) WHERE transferred=false AND deleted_at IS NULL;
CREATE OR REPLACE FUNCTION propagate_meeting_topic_section() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.section IS DISTINCT FROM NEW.section THEN UPDATE meeting_topics SET section=NEW.section WHERE parent_id=NEW.id AND deleted_at IS NULL; END IF;
 RETURN NEW;
END $$;
