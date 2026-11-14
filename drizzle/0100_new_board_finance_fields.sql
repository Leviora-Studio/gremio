-- Remove obsolete field configuration only on boards created after the legacy
-- cutoff. Stored card values, plans and every legacy board remain untouched.
DELETE FROM board_card_fields
WHERE field_key IN ('account','budget_title','approved_amount')
AND board_id IN (SELECT id FROM boards WHERE NOT legacy_finance_fields);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_legacy_board_finance_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='boards' THEN
  IF NEW.legacy_finance_fields IS DISTINCT FROM OLD.legacy_finance_fields THEN RAISE EXCEPTION 'Die Finanzfeld-Kompatibilität eines Boards ist unveränderlich.'; END IF;
 ELSE
  IF NEW.field_key IN ('account','budget_title','approved_amount') AND NOT (SELECT legacy_finance_fields FROM boards WHERE id=NEW.board_id) THEN RAISE EXCEPTION 'Beträge, Konten und Haushaltstitel werden auf neuen Boards ausschließlich je Einplanung erfasst.'; END IF;
 END IF;
 RETURN NEW;
END $$;
