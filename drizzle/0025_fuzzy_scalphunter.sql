ALTER TABLE "api_tokens" ADD COLUMN "restricted" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Backfill: bestehende Tokens mit Board-Beschränkungszeilen waren beschränkt.
UPDATE "api_tokens" SET "restricted" = true WHERE "id" IN (SELECT DISTINCT "token_id" FROM "api_token_boards");