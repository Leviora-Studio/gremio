CREATE TABLE IF NOT EXISTS "user_board_order" (
	"user_id" integer NOT NULL,
	"board_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_board_order_user_id_board_id_pk" PRIMARY KEY("user_id","board_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_finance_board_order" (
	"user_id" integer NOT NULL,
	"finance_board_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_finance_board_order_user_id_finance_board_id_pk" PRIMARY KEY("user_id","finance_board_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_board_order" ADD CONSTRAINT "user_board_order_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_board_order" ADD CONSTRAINT "user_board_order_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_finance_board_order" ADD CONSTRAINT "user_finance_board_order_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_finance_board_order" ADD CONSTRAINT "user_finance_board_order_finance_board_id_finance_boards_id_fk" FOREIGN KEY ("finance_board_id") REFERENCES "public"."finance_boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
