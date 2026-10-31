ALTER TABLE "feedback_areas" ADD COLUMN "receipt_branding_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_areas" ADD COLUMN "receipt_organization" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback_areas" ADD COLUMN "receipt_logo_png" text;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "receipt_branding_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "receipt_organization" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "locations" ADD COLUMN "receipt_logo_png" text;