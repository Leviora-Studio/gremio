CREATE TABLE "protocol_guests" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"name" text NOT NULL,
	"affiliation" text DEFAULT '' NOT NULL,
	"concern" text DEFAULT '' NOT NULL,
	CONSTRAINT "protocol_guests_name_check" CHECK (length(trim("protocol_guests"."name")) between 1 and 200),
	CONSTRAINT "protocol_guests_fields_check" CHECK (length("protocol_guests"."affiliation") <= 300 and length("protocol_guests"."concern") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "protocol_guests" ADD CONSTRAINT "protocol_guests_session_id_protocol_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."protocol_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "protocol_guests_session_order_idx" ON "protocol_guests" USING btree ("session_id","id");