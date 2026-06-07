ALTER TABLE "cards" DROP CONSTRAINT IF EXISTS "cards_priority_check";--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "priority_id" integer;--> statement-breakpoint
ALTER TABLE "priorities" DROP CONSTRAINT "priorities_pkey";--> statement-breakpoint
ALTER TABLE "priorities" ADD COLUMN "id" serial PRIMARY KEY NOT NULL;--> statement-breakpoint
ALTER TABLE "priorities" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "cards" SET "priority_id" = "priorities"."id" FROM "priorities" WHERE "cards"."priority" = "priorities"."key";--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cards" ADD CONSTRAINT "cards_priority_id_priorities_id_fk" FOREIGN KEY ("priority_id") REFERENCES "public"."priorities"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN IF EXISTS "priority";--> statement-breakpoint
ALTER TABLE "priorities" DROP COLUMN IF EXISTS "key";
