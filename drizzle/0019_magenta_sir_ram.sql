CREATE TABLE IF NOT EXISTS "api_token_boards" (
	"token_id" integer NOT NULL,
	"board_id" integer NOT NULL,
	CONSTRAINT "api_token_boards_token_id_board_id_pk" PRIMARY KEY("token_id","board_id")
);
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD COLUMN "scope" text DEFAULT 'write' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_token_boards" ADD CONSTRAINT "api_token_boards_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "public"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "api_token_boards" ADD CONSTRAINT "api_token_boards_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "api_tokens" ADD CONSTRAINT "api_tokens_scope_check" CHECK ("api_tokens"."scope" in ('read','write'));