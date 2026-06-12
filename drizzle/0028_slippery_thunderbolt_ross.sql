ALTER TABLE "board_statuses" ADD COLUMN "is_transfer_trigger" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" ADD COLUMN "transfer_date" text;--> statement-breakpoint
CREATE UNIQUE INDEX "board_statuses_one_transfer_trigger" ON "board_statuses" USING btree ("board_id") WHERE "board_statuses"."is_transfer_trigger" = true;--> statement-breakpoint
-- Bestehende Boards: neues Kartenfeld "transfer_date" sichtbar ans Ende hängen
-- (neue Boards erhalten es über createBoardFromTemplate / CARD_FIELD_KEYS).
INSERT INTO "board_card_fields" ("board_id", "field_key", "visible", "position")
SELECT b."id", 'transfer_date', true,
       COALESCE((SELECT MAX(f."position") + 1 FROM "board_card_fields" f WHERE f."board_id" = b."id"), 0)
FROM "boards" b
ON CONFLICT ("board_id", "field_key") DO NOTHING;