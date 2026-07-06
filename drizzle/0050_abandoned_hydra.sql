ALTER TABLE "inventory_loans" ADD COLUMN "requested_quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Backfill: angefragte Stückzahl = Anzahl der bereits zugeordneten Stücke.
UPDATE "inventory_loans" l
SET "requested_quantity" = GREATEST(1, (
  SELECT count(*) FROM "inventory_loan_items" li WHERE li."loan_id" = l."id"
));