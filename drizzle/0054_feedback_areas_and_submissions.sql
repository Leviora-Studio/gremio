CREATE TABLE "feedback_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"target_board_id" integer,
	"target_status_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_areas_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "feedback_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"card_id" integer NOT NULL,
	"area_id" integer,
	"area_name" text NOT NULL,
	"submitter_name" text NOT NULL,
	"feedback_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_submissions_card_id_unique" UNIQUE("card_id")
);
--> statement-breakpoint
ALTER TABLE "feedback_areas" ADD CONSTRAINT "feedback_areas_target_board_id_boards_id_fk" FOREIGN KEY ("target_board_id") REFERENCES "public"."boards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_areas" ADD CONSTRAINT "feedback_areas_target_status_id_board_statuses_id_fk" FOREIGN KEY ("target_status_id") REFERENCES "public"."board_statuses"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_submissions" ADD CONSTRAINT "feedback_submissions_area_id_feedback_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."feedback_areas"("id") ON DELETE set null ON UPDATE no action;