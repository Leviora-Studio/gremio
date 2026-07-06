CREATE TABLE "user_inventory_board_order" (
	"user_id" integer NOT NULL,
	"board_id" integer NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "user_inventory_board_order_user_id_board_id_pk" PRIMARY KEY("user_id","board_id")
);
--> statement-breakpoint
ALTER TABLE "user_inventory_board_order" ADD CONSTRAINT "user_inventory_board_order_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_inventory_board_order" ADD CONSTRAINT "user_inventory_board_order_board_id_inventory_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."inventory_boards"("id") ON DELETE cascade ON UPDATE no action;