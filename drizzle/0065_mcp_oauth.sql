CREATE TABLE "mcp_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcp_codes" (
	"hash" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"challenge" text NOT NULL,
	"resource" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mcp_grant_boards" (
	"grant_id" text NOT NULL,
	"board_id" integer NOT NULL,
	CONSTRAINT "mcp_grant_boards_grant_id_board_id_pk" PRIMARY KEY("grant_id","board_id")
);
--> statement-breakpoint
CREATE TABLE "mcp_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"scope" text NOT NULL,
	"restricted" boolean DEFAULT true NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mcp_grants_scope_check" CHECK ("mcp_grants"."scope" in ('read','write'))
);
--> statement-breakpoint
CREATE TABLE "mcp_tokens" (
	"hash" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"kind" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "mcp_codes" ADD CONSTRAINT "mcp_codes_grant_id_mcp_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant_boards" ADD CONSTRAINT "mcp_grant_boards_grant_id_mcp_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grant_boards" ADD CONSTRAINT "mcp_grant_boards_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_client_id_mcp_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."mcp_clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_grant_id_mcp_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."mcp_grants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_tokens_grant_idx" ON "mcp_tokens" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "mcp_tokens_expiry_idx" ON "mcp_tokens" USING btree ("expires_at");