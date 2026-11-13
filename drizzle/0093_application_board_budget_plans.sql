ALTER TABLE "boards" ADD COLUMN "is_application_board" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE "card_budget_plans" (
  "card_id" integer PRIMARY KEY REFERENCES "cards"("id") ON DELETE CASCADE,
  "revision" integer DEFAULT 0 NOT NULL,
  "allocations" jsonb DEFAULT '[]'::jsonb NOT NULL,
  CONSTRAINT "card_budget_plans_array" CHECK (jsonb_typeof("allocations") = 'array')
);
