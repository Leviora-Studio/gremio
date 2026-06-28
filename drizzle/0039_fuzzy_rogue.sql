CREATE TABLE "inventory_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"loan_id" integer,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"path" text NOT NULL,
	"mime" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" integer,
	CONSTRAINT "inventory_attachments_kind" CHECK ("inventory_attachments"."kind" in ('receipt','loan_request','loan_contract','other'))
);
--> statement-breakpoint
ALTER TABLE "inventory_attachments" ADD CONSTRAINT "inventory_attachments_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_attachments" ADD CONSTRAINT "inventory_attachments_loan_id_inventory_loans_id_fk" FOREIGN KEY ("loan_id") REFERENCES "public"."inventory_loans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_attachments" ADD CONSTRAINT "inventory_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;