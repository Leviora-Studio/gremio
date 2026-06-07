ALTER TABLE "cards" ADD COLUMN "archive_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "archive_first_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "archive_last_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "archive_last_error" text;