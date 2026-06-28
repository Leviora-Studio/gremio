CREATE TABLE "inventory_board_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"board_id" integer NOT NULL,
	"user_id" integer,
	"group_id" integer,
	CONSTRAINT "inventory_board_access_one_subject" CHECK (("inventory_board_access"."user_id" is null) <> ("inventory_board_access"."group_id" is null))
);
--> statement-breakpoint
CREATE TABLE "inventory_boards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_id" integer NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_board_access" ADD CONSTRAINT "inventory_board_access_board_id_inventory_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."inventory_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_board_access" ADD CONSTRAINT "inventory_board_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_board_access" ADD CONSTRAINT "inventory_board_access_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_boards" ADD CONSTRAINT "inventory_boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_board_access_board_user_uq" ON "inventory_board_access" USING btree ("board_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_board_access_board_group_uq" ON "inventory_board_access" USING btree ("board_id","group_id");