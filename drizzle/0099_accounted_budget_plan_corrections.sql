-- Existing boards retain their optional legacy finance fields; new boards do not get them.
ALTER TABLE boards ADD COLUMN legacy_finance_fields boolean NOT NULL DEFAULT true;
ALTER TABLE boards ALTER COLUMN legacy_finance_fields SET DEFAULT false;
--> statement-breakpoint
-- Enrich plans without changing amounts, titles, order or revision. Freeze protection
-- is suspended only for this additive upgrade and reinstated immediately afterwards.
ALTER TABLE card_budget_plans DISABLE TRIGGER card_budget_plans_freeze;
UPDATE card_budget_plans p SET allocations=(SELECT coalesce(jsonb_agg(row.value || jsonb_build_object('accountId',coalesce((row.value->>'accountId')::integer,c.account_id,b.default_account_id)) ORDER BY row.ordinality),'[]'::jsonb) FROM jsonb_array_elements(p.allocations) WITH ORDINALITY row(value,ordinality)) FROM cards c JOIN boards b ON b.id=c.board_id WHERE c.id=p.card_id;
ALTER TABLE card_budget_plans ENABLE TRIGGER card_budget_plans_freeze;
--> statement-breakpoint
CREATE TABLE card_budget_plan_corrections (
 id serial PRIMARY KEY,
 card_id integer NOT NULL REFERENCES cards(id) ON DELETE RESTRICT,
 revision integer NOT NULL,
 before_allocations jsonb NOT NULL,
 after_allocations jsonb NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 4000),
 user_id integer NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 transaction_id bigint NOT NULL DEFAULT txid_current(),
 CONSTRAINT card_budget_plan_corrections_revision_unique UNIQUE(card_id,revision)
);
CREATE FUNCTION immutable_budget_plan_correction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Korrektureinträge der Haushaltstitel-Einplanung sind unveränderlich.'; END $$;
CREATE TRIGGER immutable_budget_plan_correction BEFORE UPDATE OR DELETE ON card_budget_plan_corrections FOR EACH ROW EXECUTE FUNCTION immutable_budget_plan_correction();
--> statement-breakpoint
CREATE FUNCTION enforce_budget_plan_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id integer; frozen timestamptz; previous jsonb; previous_revision integer;
BEGIN
 IF TG_OP='DELETE' THEN parent_id:=OLD.card_id; ELSE parent_id:=NEW.card_id; END IF;
 SELECT locked_at INTO frozen FROM cards WHERE id=parent_id FOR UPDATE;
 IF TG_OP='UPDATE' AND NEW.card_id<>OLD.card_id THEN RAISE EXCEPTION 'Einplanungen können nicht verschoben werden.'; END IF;
 IF frozen IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Gesperrte Einplanungen dürfen nicht gelöscht werden.'; END IF;
  IF TG_OP='INSERT' THEN previous:='[]'::jsonb; previous_revision:=0;
  ELSE previous:=OLD.allocations; previous_revision:=OLD.revision; END IF;
  IF NEW.revision<>previous_revision+1 OR NOT EXISTS(SELECT 1 FROM card_budget_plan_corrections c WHERE c.card_id=parent_id AND c.revision=NEW.revision AND c.before_allocations=previous AND c.after_allocations=NEW.allocations AND c.transaction_id=txid_current()) THEN RAISE EXCEPTION 'Eine gesperrte Einplanung erfordert einen begründeten Korrektureintrag.'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER card_budget_plans_freeze ON card_budget_plans;
CREATE TRIGGER card_budget_plans_freeze BEFORE INSERT OR UPDATE OR DELETE ON card_budget_plans FOR EACH ROW EXECUTE FUNCTION enforce_budget_plan_freeze();
--> statement-breakpoint
CREATE FUNCTION enforce_legacy_board_finance_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='boards' THEN
  IF NEW.legacy_finance_fields IS DISTINCT FROM OLD.legacy_finance_fields THEN RAISE EXCEPTION 'Die Finanzfeld-Kompatibilität eines Boards ist unveränderlich.'; END IF;
 ELSE
  IF NEW.field_key IN ('account','approved_amount') AND NOT (SELECT legacy_finance_fields FROM boards WHERE id=NEW.board_id) THEN RAISE EXCEPTION 'Konto und genehmigter Betrag werden auf neuen Boards je Haushaltstitel eingeplant.'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER board_legacy_finance_fields BEFORE UPDATE ON boards FOR EACH ROW EXECUTE FUNCTION enforce_legacy_board_finance_fields();
CREATE TRIGGER board_card_legacy_finance_fields BEFORE INSERT OR UPDATE ON board_card_fields FOR EACH ROW EXECUTE FUNCTION enforce_legacy_board_finance_fields();

--> statement-breakpoint
CREATE FUNCTION preserve_planning_accounts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM card_budget_plans WHERE allocations @> jsonb_build_array(jsonb_build_object('accountId',OLD.id))) OR EXISTS(SELECT 1 FROM card_budget_plan_corrections WHERE before_allocations @> jsonb_build_array(jsonb_build_object('accountId',OLD.id)) OR after_allocations @> jsonb_build_array(jsonb_build_object('accountId',OLD.id))) THEN RAISE EXCEPTION 'Das Konto wird von einer Haushaltstitel-Einplanung verwendet.' USING ERRCODE='23503'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER preserve_planning_accounts BEFORE DELETE ON accounts FOR EACH ROW EXECUTE FUNCTION preserve_planning_accounts();
