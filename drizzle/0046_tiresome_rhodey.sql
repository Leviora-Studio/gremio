CREATE TABLE "inventory_overview_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"min_price" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_boards" ADD COLUMN "include_in_overview" boolean DEFAULT false NOT NULL;