ALTER TABLE "users" ADD COLUMN "cert_p12_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cert_pass_enc" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cert_subject" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cert_not_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "cert_uploaded_at" timestamp with time zone;