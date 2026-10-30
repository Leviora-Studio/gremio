CREATE TABLE "board_email_rules" (
	"status_id" integer PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"recipients" text[] DEFAULT '{}'::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_confirmation_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"board_id" integer,
	"inventory_board_id" integer,
	"enabled" boolean DEFAULT false NOT NULL,
	CONSTRAINT "email_confirmation_subject_check" CHECK (("email_confirmation_settings"."kind" in ('application','feedback') and "email_confirmation_settings"."board_id" is not null and "email_confirmation_settings"."inventory_board_id" is null) or ("email_confirmation_settings"."kind" = 'inventory' and "email_confirmation_settings"."inventory_board_id" is not null and "email_confirmation_settings"."board_id" is null))
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"payload" jsonb NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_outbox_state_check" CHECK ("email_outbox"."state" in ('pending','sending','sent','failed')),
	CONSTRAINT "email_outbox_kind_check" CHECK ("email_outbox"."kind" in ('status','application','feedback','inventory'))
);
--> statement-breakpoint
CREATE TABLE "smtp_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 587 NOT NULL,
	"security" text DEFAULT 'starttls' NOT NULL,
	"username" text,
	"password_enc" text,
	"from_email" text NOT NULL,
	"from_name" text DEFAULT 'Gremio' NOT NULL,
	"reply_to" text,
	CONSTRAINT "smtp_settings_singleton" CHECK ("smtp_settings"."id" = 1),
	CONSTRAINT "smtp_settings_security_check" CHECK ("smtp_settings"."security" in ('starttls','tls','none')),
	CONSTRAINT "smtp_settings_port_check" CHECK ("smtp_settings"."port" between 1 and 65535)
);
--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "submitter_email" text;--> statement-breakpoint
ALTER TABLE "board_email_rules" ADD CONSTRAINT "board_email_rules_status_id_board_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."board_statuses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_confirmation_settings" ADD CONSTRAINT "email_confirmation_settings_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_confirmation_settings" ADD CONSTRAINT "email_confirmation_settings_inventory_board_id_inventory_boards_id_fk" FOREIGN KEY ("inventory_board_id") REFERENCES "public"."inventory_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_confirmation_board_kind_uq" ON "email_confirmation_settings" USING btree ("board_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "email_confirmation_inventory_uq" ON "email_confirmation_settings" USING btree ("inventory_board_id");--> statement-breakpoint
CREATE INDEX "email_outbox_due_idx" ON "email_outbox" USING btree ("state","next_attempt_at");
--> statement-breakpoint
CREATE FUNCTION queue_board_status_email() RETURNS trigger LANGUAGE plpgsql AS $mail$
DECLARE rule record; target_name text; board_name text; recipient text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status_id IS NOT DISTINCT FROM OLD.status_id THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM smtp_settings WHERE id=1 AND enabled=true) THEN RETURN NEW; END IF;
  SELECT * INTO rule FROM board_email_rules WHERE status_id=NEW.status_id AND enabled=true;
  IF NOT FOUND THEN RETURN NEW; END IF;
  SELECT s.name,b.name INTO target_name,board_name FROM board_statuses s JOIN boards b ON b.id=s.board_id WHERE s.id=NEW.status_id AND s.board_id=NEW.board_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  FOREACH recipient IN ARRAY rule.recipients LOOP
    INSERT INTO email_outbox(kind,recipient,payload) VALUES ('status',recipient,jsonb_build_object('title',NEW.title,'boardName',board_name,'statusName',target_name,'cardId',NEW.id));
  END LOOP;
  RETURN NEW;
END;
$mail$;
--> statement-breakpoint
CREATE TRIGGER cards_queue_status_email AFTER INSERT OR UPDATE OF status_id ON cards FOR EACH ROW EXECUTE FUNCTION queue_board_status_email();
