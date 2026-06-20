CREATE TABLE "card_assignees" (
	"card_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "card_assignees_card_id_user_id_pk" PRIMARY KEY("card_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_assignee_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "card_assignees" ADD CONSTRAINT "card_assignees_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_assignees" ADD CONSTRAINT "card_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "card_assignees" ("card_id","user_id") SELECT "id","assignee_user_id" FROM "cards" WHERE "assignee_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" DROP COLUMN "assignee_user_id";