CREATE TABLE IF NOT EXISTS "priorities" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"color" text DEFAULT 'slate' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
