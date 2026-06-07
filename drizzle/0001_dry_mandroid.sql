CREATE TABLE IF NOT EXISTS "board_template_statuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"template_id" integer NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_archive_trigger" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "board_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "board_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_template_statuses" ADD CONSTRAINT "board_template_statuses_template_id_board_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."board_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "board_template_statuses_one_trigger" ON "board_template_statuses" USING btree ("template_id") WHERE "board_template_statuses"."is_archive_trigger" = true;