CREATE TABLE "protocol_logos" (
	"id" serial PRIMARY KEY NOT NULL,
	"area_id" integer NOT NULL,
	"name" text NOT NULL,
	"png_base64" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "protocol_logos" ADD CONSTRAINT "protocol_logos_area_id_protocol_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."protocol_areas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "protocol_logos_area_idx" ON "protocol_logos" USING btree ("area_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "protocol_logos_default_uq" ON "protocol_logos" USING btree ("area_id") WHERE "protocol_logos"."is_default" = true;