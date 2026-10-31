CREATE TABLE "board_owners" (
	"board_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "board_owners_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "finance_board_owners" (
	"board_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "finance_board_owners_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_board_owners" (
	"board_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "inventory_board_owners_board_id_user_id_pk" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "receipt_branding" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"organization" text DEFAULT '' NOT NULL,
	"logo_png" text,
	CONSTRAINT "receipt_branding_singleton" CHECK ("receipt_branding"."id"=1)
);
--> statement-breakpoint
ALTER TABLE "board_owners" ADD CONSTRAINT "board_owners_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_owners" ADD CONSTRAINT "board_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_board_owners" ADD CONSTRAINT "finance_board_owners_board_id_finance_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."finance_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_board_owners" ADD CONSTRAINT "finance_board_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_board_owners" ADD CONSTRAINT "inventory_board_owners_board_id_inventory_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."inventory_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_board_owners" ADD CONSTRAINT "inventory_board_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;