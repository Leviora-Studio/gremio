-- Preserve all stored card values. New boards no longer expose legacy totals/dates.
DELETE FROM board_card_fields WHERE field_key IN ('actual_amount','instruction_date','transfer_date') AND board_id IN (SELECT id FROM boards WHERE NOT legacy_finance_fields);
ALTER TABLE boards ADD COLUMN attachment_fields jsonb;
ALTER TABLE boards ADD CONSTRAINT boards_attachment_fields_check CHECK (attachment_fields IS NULL OR (jsonb_typeof(attachment_fields)='array' AND attachment_fields <@ '["finance_request","annex_a","annex_b","student_card","receipts"]'::jsonb));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_legacy_board_finance_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='boards' THEN
  IF NEW.legacy_finance_fields IS DISTINCT FROM OLD.legacy_finance_fields THEN RAISE EXCEPTION 'Die Finanzfeld-Kompatibilität eines Boards ist unveränderlich.'; END IF;
 ELSE
  IF NEW.field_key IN ('account','budget_title','approved_amount','actual_amount','instruction_date','transfer_date') AND NOT (SELECT legacy_finance_fields FROM boards WHERE id=NEW.board_id) THEN RAISE EXCEPTION 'Finanzwerte und Zahlungsdaten werden auf neuen Boards über Einplanung und Kassenbuch geführt.'; END IF;
 END IF;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION enforce_board_attachment_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configured jsonb; parent_id integer;
BEGIN
 IF TG_TABLE_NAME='boards' THEN
  IF NEW.is_application_board IS DISTINCT FROM OLD.is_application_board OR NEW.attachment_fields IS DISTINCT FROM OLD.attachment_fields THEN RAISE EXCEPTION 'Boardtyp und Anhangsbereiche werden beim Erstellen festgelegt.'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN parent_id:=OLD.board_id; ELSE parent_id:=NEW.board_id; END IF;
 SELECT attachment_fields INTO configured FROM boards WHERE id=parent_id;
 IF configured IS NOT NULL THEN
  IF TG_OP='UPDATE' AND OLD.field_key IN ('finance_request','annex_a','annex_b','student_card','receipts') AND (NEW.field_key IS DISTINCT FROM OLD.field_key OR NEW.board_id IS DISTINCT FROM OLD.board_id) THEN RAISE EXCEPTION 'Feste Anhangsbereiche können nicht umgewidmet werden.'; END IF;
  IF TG_OP='DELETE' THEN
   IF OLD.field_key IN ('finance_request','annex_a','annex_b','student_card','receipts') AND configured ? OLD.field_key THEN RAISE EXCEPTION 'Feste Anhangsbereiche können nicht entfernt werden.'; END IF;
   RETURN OLD;
  END IF;
  IF NEW.field_key IN ('finance_request','annex_a','annex_b','student_card','receipts') AND NEW.visible IS DISTINCT FROM (configured ? NEW.field_key) THEN RAISE EXCEPTION 'Anhangsbereiche werden beim Erstellen festgelegt.'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER boards_fixed_attachments BEFORE UPDATE ON boards FOR EACH ROW EXECUTE FUNCTION enforce_board_attachment_configuration();
CREATE TRIGGER board_fields_fixed_attachments BEFORE INSERT OR UPDATE OR DELETE ON board_card_fields FOR EACH ROW EXECUTE FUNCTION enforce_board_attachment_configuration();
--> statement-breakpoint
ALTER TABLE locations ADD COLUMN module text NOT NULL DEFAULT 'locations' CHECK (module IN ('locations','finance'));
ALTER TABLE locations DROP CONSTRAINT locations_name_unique;
ALTER TABLE locations ADD CONSTRAINT locations_module_name_unique UNIQUE(module,name);
CREATE TABLE application_form_modules (
 id integer PRIMARY KEY DEFAULT 1 CHECK(id=1),
 active_module text DEFAULT 'locations' CHECK(active_module IN ('locations','finance')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0)
);
INSERT INTO application_form_modules(id,active_module) VALUES (1,'locations');
--> statement-breakpoint
CREATE FUNCTION protect_finance_form_target() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.module='finance' AND NEW.target_board_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM boards WHERE id=NEW.target_board_id AND is_application_board AND inventory_board_id IS NULL) THEN RAISE EXCEPTION 'Das Finanzanträge-Formular benötigt ein Antragsboard als Ziel.'; END IF;
 IF TG_OP='UPDATE' AND NEW.module IS DISTINCT FROM OLD.module THEN RAISE EXCEPTION 'Die Modulzuordnung eines Standorts ist unveränderlich.'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER finance_form_target BEFORE INSERT OR UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION protect_finance_form_target();
--> statement-breakpoint
CREATE FUNCTION enforce_fixed_attachment_types() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE configured jsonb;
BEGIN
 SELECT b.attachment_fields INTO configured FROM cards c JOIN boards b ON b.id=c.board_id WHERE c.id=NEW.card_id;
 IF configured IS NOT NULL THEN
  IF NEW.kind IN ('finance_request','annex_a','annex_b','student_card') AND NOT (configured ? NEW.kind) THEN RAISE EXCEPTION 'Dieser Anhangstyp ist für das Board nicht eingerichtet.'; END IF;
  IF NEW.kind='other' AND NEW.upload_purpose='receipt' AND NOT (configured ? 'receipts') THEN RAISE EXCEPTION 'Dieses Board hat keinen Quittungsbereich.'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attachment_fixed_types BEFORE INSERT OR UPDATE ON attachments FOR EACH ROW EXECUTE FUNCTION enforce_fixed_attachment_types();
