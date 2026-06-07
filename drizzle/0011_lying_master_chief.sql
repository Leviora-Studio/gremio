CREATE TABLE IF NOT EXISTS "finance_template_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"parent_id" integer,
	"haushaltstitel" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"planned_amount" integer,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_template_items" ADD CONSTRAINT "finance_template_items_template_id_finance_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."finance_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_template_items" ADD CONSTRAINT "finance_template_items_parent_id_finance_template_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."finance_template_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
