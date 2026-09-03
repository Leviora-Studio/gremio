CREATE TABLE "protocol_area_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"area_id" integer NOT NULL,
	"user_id" integer,
	"group_id" integer,
	CONSTRAINT "protocol_area_access_one_subject" CHECK (("protocol_area_access"."user_id" is null) <> ("protocol_area_access"."group_id" is null))
);
--> statement-breakpoint
CREATE TABLE "protocol_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_id" integer NOT NULL,
	"nc_url" text NOT NULL,
	"nc_username" text NOT NULL,
	"nc_password_enc" text NOT NULL,
	"root_path" text NOT NULL,
	"folder_pattern" text DEFAULT '{YYYY}-{MM}-{DD}' NOT NULL,
	"file_pattern" text DEFAULT 'Protokoll.md' NOT NULL,
	"template_id" integer NOT NULL,
	"board_id" integer,
	"source_status_id" integer,
	"decision_ref_pattern" text DEFAULT '{session}-TOP-{top}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocol_card_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"card_id" integer NOT NULL,
	"top" text NOT NULL,
	"last_auto_decision_ref" text,
	"decision_ref_conflict" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocol_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"area_id" integer NOT NULL,
	"folder_name" text NOT NULL,
	"session_date" text,
	"folder_file_id" text,
	"folder_etag" text,
	"protocol_path" text,
	"protocol_file_id" text,
	"protocol_etag" text,
	"protocol_last_modified" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protocol_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"markdown" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protocol_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "protocol_area_access" ADD CONSTRAINT "protocol_area_access_area_id_protocol_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."protocol_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_area_access" ADD CONSTRAINT "protocol_area_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_area_access" ADD CONSTRAINT "protocol_area_access_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_areas" ADD CONSTRAINT "protocol_areas_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_areas" ADD CONSTRAINT "protocol_areas_template_id_protocol_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."protocol_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_areas" ADD CONSTRAINT "protocol_areas_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_areas" ADD CONSTRAINT "protocol_areas_source_status_id_board_statuses_id_fk" FOREIGN KEY ("source_status_id") REFERENCES "public"."board_statuses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_card_links" ADD CONSTRAINT "protocol_card_links_session_id_protocol_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."protocol_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_card_links" ADD CONSTRAINT "protocol_card_links_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_sessions" ADD CONSTRAINT "protocol_sessions_area_id_protocol_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."protocol_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_area_access_area_user_uq" ON "protocol_area_access" USING btree ("area_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_area_access_area_group_uq" ON "protocol_area_access" USING btree ("area_id","group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_card_links_session_card_uq" ON "protocol_card_links" USING btree ("session_id","card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_sessions_area_folder_uq" ON "protocol_sessions" USING btree ("area_id","folder_name");