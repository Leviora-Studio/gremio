ALTER TABLE "inventory_items" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_loan_items" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_quantity" CHECK ("inventory_items"."quantity" >= 1);--> statement-breakpoint
ALTER TABLE "inventory_loan_items" ADD CONSTRAINT "inventory_loan_items_quantity" CHECK ("inventory_loan_items"."quantity" >= 1);