CREATE TABLE "finance_board_accounts" (
	"finance_board_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	CONSTRAINT "finance_board_accounts_finance_board_id_account_id_pk" PRIMARY KEY("finance_board_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "finance_boards" DROP CONSTRAINT "finance_boards_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "finance_board_accounts" ADD CONSTRAINT "finance_board_accounts_finance_board_id_finance_boards_id_fk" FOREIGN KEY ("finance_board_id") REFERENCES "public"."finance_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_board_accounts" ADD CONSTRAINT "finance_board_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Bestehende Einzel-Auswahl (finance_boards.account_id) in die n:m-Tabelle übernehmen,
-- BEVOR die Spalte entfernt wird (sonst Datenverlust).
INSERT INTO "finance_board_accounts" ("finance_board_id", "account_id")
SELECT "id", "account_id" FROM "finance_boards" WHERE "account_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "finance_boards" DROP COLUMN "account_id";