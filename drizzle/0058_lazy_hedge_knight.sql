CREATE TABLE "protocol_attendance" (
	"session_id" integer NOT NULL,
	"member_id" integer NOT NULL,
	"present" boolean DEFAULT false NOT NULL,
	"proxy_member_id" integer,
	CONSTRAINT "protocol_attendance_session_id_member_id_pk" PRIMARY KEY("session_id","member_id"),
	CONSTRAINT "protocol_attendance_no_self_proxy" CHECK ("protocol_attendance"."proxy_member_id" is null or "protocol_attendance"."proxy_member_id" <> "protocol_attendance"."member_id")
);
--> statement-breakpoint
CREATE TABLE "protocol_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"area_id" integer NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "protocol_members_name_check" CHECK (length(trim("protocol_members"."name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "protocol_attendance" ADD CONSTRAINT "protocol_attendance_session_id_protocol_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."protocol_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_attendance" ADD CONSTRAINT "protocol_attendance_member_id_protocol_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."protocol_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_attendance" ADD CONSTRAINT "protocol_attendance_proxy_member_id_protocol_members_id_fk" FOREIGN KEY ("proxy_member_id") REFERENCES "public"."protocol_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "protocol_members" ADD CONSTRAINT "protocol_members_area_id_protocol_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."protocol_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "protocol_attendance_member_idx" ON "protocol_attendance" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "protocol_attendance_proxy_idx" ON "protocol_attendance" USING btree ("proxy_member_id");--> statement-breakpoint
CREATE INDEX "protocol_members_area_order_idx" ON "protocol_members" USING btree ("area_id","position","id");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_members_area_name_uq" ON "protocol_members" USING btree ("area_id",lower("name"));