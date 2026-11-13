ALTER TABLE cashbooks ADD COLUMN next_booking_number integer NOT NULL DEFAULT 1;
ALTER TABLE cashbook_entries ADD COLUMN booking_number text;
UPDATE cashbooks SET config=jsonb_set(config,'{bookingNumbering}','{"prefix":"B","digits":4}'::jsonb) WHERE NOT config ? 'bookingNumbering';
--> statement-breakpoint
-- Only the new number is backfilled; all original accounting values remain intact.
ALTER TABLE cashbook_entries DISABLE TRIGGER cashbook_entries_immutable;
ALTER TABLE cashbook_entries DISABLE TRIGGER cashbook_submitted_freeze;
WITH numbered AS (
 SELECT e.id, row_number() OVER(PARTITION BY e.cashbook_id ORDER BY e.authorized_at,e.id) AS n,
 coalesce(b.config->'bookingNumbering'->>'prefix','B') AS prefix,
 coalesce((b.config->'bookingNumbering'->>'digits')::integer,4) AS digits
 FROM cashbook_entries e JOIN cashbooks b ON b.id=e.cashbook_id WHERE e.state='posted'
)
UPDATE cashbook_entries e SET booking_number=n.prefix||'-'||lpad(n.n::text,greatest(n.digits,length(n.n::text)),'0') FROM numbered n WHERE e.id=n.id;
UPDATE cashbooks b SET next_booking_number=(SELECT count(*)+1 FROM cashbook_entries e WHERE e.cashbook_id=b.id AND e.state='posted');
ALTER TABLE cashbook_entries ENABLE TRIGGER cashbook_entries_immutable;
ALTER TABLE cashbook_entries ENABLE TRIGGER cashbook_submitted_freeze;
CREATE UNIQUE INDEX cashbook_booking_number_unique ON cashbook_entries(cashbook_id,booking_number);
ALTER TABLE cashbook_entries ADD CONSTRAINT cashbook_booking_number_state CHECK((state='posted')=(booking_number IS NOT NULL));
--> statement-breakpoint
CREATE FUNCTION allocate_cashbook_booking_number() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE counter integer; prefix text; digits integer;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF OLD.state='posted' THEN
   IF NEW.booking_number IS DISTINCT FROM OLD.booking_number THEN RAISE EXCEPTION 'Die Buchungsnummer ist unveränderlich.'; END IF;
   RETURN NEW;
  END IF;
 END IF;
 IF NEW.state='posted' THEN
  UPDATE cashbooks SET next_booking_number=next_booking_number+1 WHERE id=NEW.cashbook_id
  RETURNING next_booking_number-1,coalesce(config->'bookingNumbering'->>'prefix','B'),coalesce((config->'bookingNumbering'->>'digits')::integer,4) INTO counter,prefix,digits;
  NEW.booking_number:=prefix||'-'||lpad(counter::text,greatest(digits,length(counter::text)),'0');
 ELSIF NEW.booking_number IS NOT NULL THEN
  RAISE EXCEPTION 'Buchungsnummern werden erst beim verbindlichen Buchen vergeben.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cashbook_booking_number BEFORE INSERT OR UPDATE ON cashbook_entries FOR EACH ROW EXECUTE FUNCTION allocate_cashbook_booking_number();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cashbook_submitted_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='submitted' THEN
  IF (to_jsonb(NEW)-ARRAY['state','revision','files','first_signed_at','second_signed_at','authorized_at','booking_number']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','files','first_signed_at','second_signed_at','authorized_at','booking_number']) THEN RAISE EXCEPTION 'Vorgelegte Vorgänge sind bis zur begründeten Rückgabe gesperrt.'; END IF;
 END IF;
 IF OLD.state='submitted' AND NEW.state<>'posted' AND NEW.authorized_at IS DISTINCT FROM OLD.authorized_at THEN RAISE EXCEPTION 'Der Anweisungszeitpunkt wird erst beim Buchen gesetzt.'; END IF;
 IF NEW.state='submitted' AND (NEW.first_signed_at IS NULL OR NEW.second_signer_id IS NULL) THEN RAISE EXCEPTION 'Vorlegen erfordert erste Unterschrift und zweite Person.'; END IF;
 IF OLD.state='submitted' AND NEW.state='posted' AND (NEW.first_signed_at IS NULL OR NEW.second_signed_at IS NULL) THEN RAISE EXCEPTION 'Anweisen erfordert beide Unterschriften.'; END IF;
 RETURN NEW;
END $$;
