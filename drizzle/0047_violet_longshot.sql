CREATE TABLE "inventory_loan_items" (
	"loan_id" integer NOT NULL,
	"item_id" integer NOT NULL,
	CONSTRAINT "inventory_loan_items_loan_id_item_id_pk" PRIMARY KEY("loan_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "group_name" text;--> statement-breakpoint
ALTER TABLE "inventory_loan_items" ADD CONSTRAINT "inventory_loan_items_loan_id_inventory_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."inventory_loans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_loan_items" ADD CONSTRAINT "inventory_loan_items_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill: jeder bestehende Vorgang bekommt sein bisheriges Leit-Stück als
-- Verknüpfung, damit die auf inventory_loan_items umgestellten Abfragen
-- (listLoans / getActiveLoanMap) für Alt-Vorgänge weiter funktionieren.
INSERT INTO "inventory_loan_items" ("loan_id", "item_id")
SELECT "id", "item_id" FROM "inventory_loans"
ON CONFLICT DO NOTHING;