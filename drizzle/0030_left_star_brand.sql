CREATE TABLE "finance_board_expense_accounts" (
	"finance_board_id" integer NOT NULL,
	"account_id" integer NOT NULL,
	CONSTRAINT "finance_board_expense_accounts_finance_board_id_account_id_pk" PRIMARY KEY("finance_board_id","account_id")
);
--> statement-breakpoint
ALTER TABLE "finance_board_expense_accounts" ADD CONSTRAINT "finance_board_expense_accounts_finance_board_id_finance_boards_id_fk" FOREIGN KEY ("finance_board_id") REFERENCES "public"."finance_boards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finance_board_expense_accounts" ADD CONSTRAINT "finance_board_expense_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;