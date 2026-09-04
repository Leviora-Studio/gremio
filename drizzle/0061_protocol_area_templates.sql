ALTER TABLE "protocol_areas" ALTER COLUMN "template_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "protocol_areas" ADD COLUMN "custom_template_markdown" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "protocol_areas" ADD COLUMN "finance_fields" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "protocol_areas" ADD COLUMN "decision_template_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "protocol_areas" ADD COLUMN "decision_template_markdown" text DEFAULT '' NOT NULL;