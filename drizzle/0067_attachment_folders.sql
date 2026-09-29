CREATE TABLE "attachment_folders" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "folder_id" integer;--> statement-breakpoint
ALTER TABLE "attachment_folders" ADD CONSTRAINT "attachment_folders_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_folders_card_name_uq" ON "attachment_folders" USING btree ("card_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "attachment_folders_card_id_uq" ON "attachment_folders" USING btree ("card_id","id");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_folder_card_fk" FOREIGN KEY ("card_id","folder_id") REFERENCES "public"."attachment_folders"("card_id","id") ON DELETE no action ON UPDATE no action;