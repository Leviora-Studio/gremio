CREATE TABLE IF NOT EXISTS "user_task_prefs" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "done_status_id" integer;--> statement-breakpoint
ALTER TABLE "boards" ADD COLUMN "done_sweep_time" text;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "done_since" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_task_prefs" ADD CONSTRAINT "user_task_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "boards" ADD CONSTRAINT "boards_done_status_id_board_statuses_id_fk" FOREIGN KEY ("done_status_id") REFERENCES "public"."board_statuses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
