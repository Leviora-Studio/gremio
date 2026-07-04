ALTER TABLE "inventory_items" ADD COLUMN "condition" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD COLUMN "condition_note" text;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_condition" CHECK ("inventory_items"."condition" in ('active','defect','lost'));