CREATE TABLE "board_trigger_assignees" (
	"board_id" integer NOT NULL,
	"trigger" text NOT NULL,
	"user_id" integer NOT NULL,
	CONSTRAINT "board_trigger_assignees_board_id_trigger_user_id_pk" PRIMARY KEY("board_id","trigger","user_id")
);
--> statement-breakpoint
CREATE TABLE "board_trigger_assignments" (
	"board_id" integer NOT NULL,
	"trigger" text NOT NULL,
	"clear_assignees" boolean DEFAULT false NOT NULL,
	CONSTRAINT "board_trigger_assignments_board_id_trigger_pk" PRIMARY KEY("board_id","trigger"),
	CONSTRAINT "board_trigger_assignments_trigger" CHECK ("board_trigger_assignments"."trigger" in ('instruction','transfer','resubmit','receipt','done','archive'))
);
--> statement-breakpoint
ALTER TABLE "board_trigger_assignees" ADD CONSTRAINT "board_trigger_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_trigger_assignees" ADD CONSTRAINT "board_trigger_assignees_config_fk" FOREIGN KEY ("board_id","trigger") REFERENCES "public"."board_trigger_assignments"("board_id","trigger") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_trigger_assignments" ADD CONSTRAINT "board_trigger_assignments_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;