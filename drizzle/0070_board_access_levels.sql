ALTER TABLE "board_access" ADD COLUMN "access_level" text DEFAULT 'write' NOT NULL;--> statement-breakpoint
ALTER TABLE "finance_board_access" ADD COLUMN "access_level" text DEFAULT 'write' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_board_access" ADD COLUMN "access_level" text DEFAULT 'write' NOT NULL;--> statement-breakpoint
ALTER TABLE "board_access" ADD CONSTRAINT "board_access_access_level_check" CHECK ("board_access"."access_level" in ('read', 'write'));--> statement-breakpoint
ALTER TABLE "finance_board_access" ADD CONSTRAINT "finance_board_access_access_level_check" CHECK ("finance_board_access"."access_level" in ('read', 'write'));--> statement-breakpoint
ALTER TABLE "inventory_board_access" ADD CONSTRAINT "inventory_board_access_access_level_check" CHECK ("inventory_board_access"."access_level" in ('read', 'write'));