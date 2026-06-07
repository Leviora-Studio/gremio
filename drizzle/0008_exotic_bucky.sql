CREATE TABLE IF NOT EXISTS "board_numbering" (
	"board_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"prefix" text DEFAULT '' NOT NULL,
	"year" text DEFAULT '' NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"separator" text DEFAULT '_' NOT NULL,
	"padding" integer DEFAULT 0 NOT NULL,
	"next" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "number" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "board_numbering" ADD CONSTRAINT "board_numbering_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
