ALTER TABLE "finance_plan_items" ADD COLUMN "kind" text DEFAULT 'expense' NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_template_items" ADD COLUMN "kind" text DEFAULT 'expense' NOT NULL;