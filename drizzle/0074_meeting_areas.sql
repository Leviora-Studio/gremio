CREATE TABLE "meeting_area_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"area_id" integer NOT NULL,
	"user_id" integer,
	"group_id" integer,
	"access_level" text DEFAULT 'read' NOT NULL,
	CONSTRAINT "meeting_area_access_subject_check" CHECK (("meeting_area_access"."user_id" is null) <> ("meeting_area_access"."group_id" is null)),
	CONSTRAINT "meeting_area_access_level_check" CHECK ("meeting_area_access"."access_level" in ('read','write'))
);
--> statement-breakpoint
CREATE TABLE "meeting_areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"owner_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Preserve each previous session's exact audience; never merge by name alone.
ALTER TABLE "meetings" ADD COLUMN "area_id" integer;
--> statement-breakpoint
INSERT INTO "meeting_areas" (id,name,owner_id,created_at)
SELECT id,coalesce(nullif(trim(committee),''),title),owner_id,created_at FROM "meetings";
--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('meeting_areas','id'),coalesce((SELECT max(id) FROM meeting_areas),1),(SELECT count(*)>0 FROM meeting_areas));
--> statement-breakpoint
UPDATE "meetings" SET area_id=id;
--> statement-breakpoint
INSERT INTO "meeting_area_access" (area_id,user_id,group_id,access_level)
SELECT meeting_id,user_id,group_id,access_level FROM "meeting_access";
--> statement-breakpoint
ALTER TABLE "meetings" ALTER COLUMN "area_id" SET NOT NULL;
--> statement-breakpoint
DROP TABLE "meeting_access";
--> statement-breakpoint
ALTER TABLE "meeting_area_access" ADD CONSTRAINT "meeting_area_access_area_id_meeting_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."meeting_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_area_access" ADD CONSTRAINT "meeting_area_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_area_access" ADD CONSTRAINT "meeting_area_access_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_areas" ADD CONSTRAINT "meeting_areas_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_area_access_person_uq" ON "meeting_area_access" USING btree ("area_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_area_access_group_uq" ON "meeting_area_access" USING btree ("area_id","group_id");--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_area_id_meeting_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."meeting_areas"("id") ON DELETE no action ON UPDATE no action;