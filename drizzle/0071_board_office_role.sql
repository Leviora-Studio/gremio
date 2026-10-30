CREATE TABLE "board_office_roles" (
	"board_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"user_id" integer
);
--> statement-breakpoint
CREATE TABLE "board_office_statuses" (
	"board_id" integer NOT NULL,
	"status_id" integer NOT NULL,
	"direction" text NOT NULL,
	CONSTRAINT "board_office_statuses_board_id_status_id_direction_pk" PRIMARY KEY("board_id","status_id","direction"),
	CONSTRAINT "board_office_statuses_direction_check" CHECK ("board_office_statuses"."direction" in ('source', 'target'))
);
--> statement-breakpoint
ALTER TABLE "board_office_roles" ADD CONSTRAINT "board_office_roles_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_office_roles" ADD CONSTRAINT "board_office_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_office_statuses" ADD CONSTRAINT "board_office_statuses_board_id_board_office_roles_board_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."board_office_roles"("board_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "board_statuses_board_id_id_uq" ON "board_statuses" USING btree ("board_id","id");--> statement-breakpoint
ALTER TABLE "board_office_statuses" ADD CONSTRAINT "board_office_statuses_same_board_fk" FOREIGN KEY ("board_id","status_id") REFERENCES "public"."board_statuses"("board_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
