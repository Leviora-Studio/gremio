CREATE TABLE "meeting_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer NOT NULL,
	"user_id" integer,
	"group_id" integer,
	"access_level" text DEFAULT 'read' NOT NULL,
	CONSTRAINT "meeting_access_subject_check" CHECK (("meeting_access"."user_id" is null) <> ("meeting_access"."group_id" is null)),
	CONSTRAINT "meeting_access_level_check" CHECK ("meeting_access"."access_level" in ('read','write'))
);
--> statement-breakpoint
CREATE TABLE "meeting_boards" (
	"meeting_id" integer NOT NULL,
	"board_id" integer NOT NULL,
	CONSTRAINT "meeting_boards_meeting_id_board_id_pk" PRIMARY KEY("meeting_id","board_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic_id" integer NOT NULL,
	"filename" text NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"uploaded_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meeting_topic_cards" (
	"topic_id" integer NOT NULL,
	"card_id" integer NOT NULL,
	CONSTRAINT "meeting_topic_cards_topic_id_card_id_pk" PRIMARY KEY("topic_id","card_id")
);
--> statement-breakpoint
CREATE TABLE "meeting_topics" (
	"id" serial PRIMARY KEY NOT NULL,
	"meeting_id" integer,
	"created_by" integer,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"motion" text DEFAULT '' NOT NULL,
	"presenter" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'discussion' NOT NULL,
	"duration_minutes" integer DEFAULT 10 NOT NULL,
	"confidential" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"outcome" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_topics_kind_check" CHECK ("meeting_topics"."kind" in ('information','discussion','decision')),
	CONSTRAINT "meeting_topics_state_check" CHECK ("meeting_topics"."state" in ('proposed','scheduled','treated','deferred','withdrawn')),
	CONSTRAINT "meeting_topics_duration_check" CHECK ("meeting_topics"."duration_minutes" between 1 and 480)
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_id" integer NOT NULL,
	"title" text NOT NULL,
	"committee" text DEFAULT '' NOT NULL,
	"starts_at" timestamp with time zone,
	"location" text DEFAULT '' NOT NULL,
	"chair" text DEFAULT '' NOT NULL,
	"submission_deadline" timestamp with time zone,
	"state" text DEFAULT 'planning' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meetings_state_check" CHECK ("meetings"."state" in ('planning','invited','held','closed'))
);
--> statement-breakpoint
ALTER TABLE "meeting_access" ADD CONSTRAINT "meeting_access_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_access" ADD CONSTRAINT "meeting_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_access" ADD CONSTRAINT "meeting_access_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_boards" ADD CONSTRAINT "meeting_boards_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_boards" ADD CONSTRAINT "meeting_boards_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_documents" ADD CONSTRAINT "meeting_documents_topic_id_meeting_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."meeting_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_documents" ADD CONSTRAINT "meeting_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topic_cards" ADD CONSTRAINT "meeting_topic_cards_topic_id_meeting_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."meeting_topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topic_cards" ADD CONSTRAINT "meeting_topic_cards_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_topics" ADD CONSTRAINT "meeting_topics_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_access_person_uq" ON "meeting_access" USING btree ("meeting_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_access_group_uq" ON "meeting_access" USING btree ("meeting_id","group_id");--> statement-breakpoint
CREATE INDEX "meeting_topics_order_idx" ON "meeting_topics" USING btree ("meeting_id","position","id");