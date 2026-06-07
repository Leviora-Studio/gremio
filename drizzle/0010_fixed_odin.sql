CREATE TABLE IF NOT EXISTS "finance_board_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"finance_board_id" integer NOT NULL,
	"user_id" integer,
	"group_id" integer,
	CONSTRAINT "finance_board_access_one_subject" CHECK (("finance_board_access"."user_id" is null) <> ("finance_board_access"."group_id" is null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_board_sources" (
	"finance_board_id" integer NOT NULL,
	"board_id" integer NOT NULL,
	CONSTRAINT "finance_board_sources_finance_board_id_board_id_pk" PRIMARY KEY("finance_board_id","board_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_boards" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"owner_id" integer NOT NULL,
	"account_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "finance_plan_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"finance_board_id" integer NOT NULL,
	"parent_id" integer,
	"haushaltstitel" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"planned_amount" integer,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_board_access" ADD CONSTRAINT "finance_board_access_finance_board_id_finance_boards_id_fk" FOREIGN KEY ("finance_board_id") REFERENCES "public"."finance_boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_board_access" ADD CONSTRAINT "finance_board_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_board_access" ADD CONSTRAINT "finance_board_access_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_board_sources" ADD CONSTRAINT "finance_board_sources_finance_board_id_finance_boards_id_fk" FOREIGN KEY ("finance_board_id") REFERENCES "public"."finance_boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_board_sources" ADD CONSTRAINT "finance_board_sources_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_boards" ADD CONSTRAINT "finance_boards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_boards" ADD CONSTRAINT "finance_boards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_plan_items" ADD CONSTRAINT "finance_plan_items_finance_board_id_finance_boards_id_fk" FOREIGN KEY ("finance_board_id") REFERENCES "public"."finance_boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "finance_plan_items" ADD CONSTRAINT "finance_plan_items_parent_id_finance_plan_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."finance_plan_items"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "finance_board_access_user_uq" ON "finance_board_access" USING btree ("finance_board_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "finance_board_access_group_uq" ON "finance_board_access" USING btree ("finance_board_id","group_id");