CREATE TABLE "inventory_board_fields" (
	"board_id" integer NOT NULL,
	"field_key" text NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_board_fields_board_id_field_key_pk" PRIMARY KEY("board_id","field_key")
);
--> statement-breakpoint
CREATE TABLE "inventory_item_categories" (
	"item_id" integer NOT NULL,
	"option_id" integer NOT NULL,
	CONSTRAINT "inventory_item_categories_item_id_option_id_pk" PRIMARY KEY("item_id","option_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"board_id" integer NOT NULL,
	"number" text,
	"name" text DEFAULT '' NOT NULL,
	"location_id" integer,
	"loan_status_id" integer,
	"price" integer,
	"purchase_date" text,
	"vendor" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"creator_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "inventory_numbering" (
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
CREATE TABLE "inventory_options" (
	"id" serial PRIMARY KEY NOT NULL,
	"board_id" integer NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_options_kind" CHECK ("inventory_options"."kind" in ('category','location','loan_status'))
);
--> statement-breakpoint
ALTER TABLE "inventory_board_fields" ADD CONSTRAINT "inventory_board_fields_board_id_inventory_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."inventory_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_categories" ADD CONSTRAINT "inventory_item_categories_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_categories" ADD CONSTRAINT "inventory_item_categories_option_id_inventory_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."inventory_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_board_id_inventory_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."inventory_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_inventory_options_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."inventory_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_loan_status_id_inventory_options_id_fk" FOREIGN KEY ("loan_status_id") REFERENCES "public"."inventory_options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_creator_user_id_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_numbering" ADD CONSTRAINT "inventory_numbering_board_id_inventory_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."inventory_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_options" ADD CONSTRAINT "inventory_options_board_id_inventory_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."inventory_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_options_board_kind_name_uq" ON "inventory_options" USING btree ("board_id","kind","name");