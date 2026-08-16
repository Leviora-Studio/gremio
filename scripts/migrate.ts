// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./drizzle" });

  // Realtime: NOTIFY-Trigger auf `cards` (idempotent) — spiegelt
  // lib/realtime.ts ensureCardChangeTrigger() für lokale Migrationen.
  await pool.query(`
    CREATE OR REPLACE FUNCTION notify_card_change() RETURNS trigger AS $fn$
    DECLARE rec record;
    BEGIN
      IF (TG_OP = 'DELETE') THEN rec := OLD; ELSE rec := NEW; END IF;
      PERFORM pg_notify(
        'card_change',
        json_build_object('boardId', rec.board_id, 'token', rec.token)::text
      );
      RETURN rec;
    END;
    $fn$ LANGUAGE plpgsql;
  `);
  await pool.query(`DROP TRIGGER IF EXISTS cards_notify_change ON cards;`);
  await pool.query(`
    CREATE TRIGGER cards_notify_change
    AFTER INSERT OR UPDATE OR DELETE ON cards
    FOR EACH ROW EXECUTE FUNCTION notify_card_change();
  `);

  // Inventar-Realtime — spiegelt lib/realtime.ts ensureInventoryChangeTrigger().
  await pool.query(`
    CREATE OR REPLACE FUNCTION notify_inventory_change() RETURNS trigger AS $fn$
    DECLARE rec record; v_board int; v_token text;
    BEGIN
      IF (TG_OP = 'DELETE') THEN rec := OLD; ELSE rec := NEW; END IF;
      v_board := NULL; v_token := NULL;
      IF TG_TABLE_NAME = 'inventory_items' THEN
        v_board := rec.board_id;
      ELSIF TG_TABLE_NAME = 'inventory_loans' THEN
        SELECT board_id INTO v_board FROM inventory_items WHERE id = rec.item_id;
        v_token := rec.token;
      ELSIF TG_TABLE_NAME = 'inventory_attachments' THEN
        -- rec.loan_id nur hier referenzieren: nur diese Tabelle hat die Spalte.
        SELECT board_id INTO v_board FROM inventory_items WHERE id = rec.item_id;
        IF rec.loan_id IS NOT NULL THEN
          SELECT token INTO v_token FROM inventory_loans WHERE id = rec.loan_id;
        END IF;
      ELSE
        -- inventory_defects u. a.: nur item_id vorhanden, KEIN loan_id.
        SELECT board_id INTO v_board FROM inventory_items WHERE id = rec.item_id;
      END IF;
      PERFORM pg_notify(
        'inventory_change',
        json_build_object('boardId', v_board, 'token', v_token)::text
      );
      RETURN rec;
    END;
    $fn$ LANGUAGE plpgsql;
  `);
  for (const t of [
    "inventory_items",
    "inventory_loans",
    "inventory_loan_items",
    "inventory_defects",
    "inventory_attachments",
  ]) {
    await pool.query(`DROP TRIGGER IF EXISTS ${t}_notify_change ON ${t};`);
    await pool.query(`
      CREATE TRIGGER ${t}_notify_change
      AFTER INSERT OR UPDATE OR DELETE ON ${t}
      FOR EACH ROW EXECUTE FUNCTION notify_inventory_change();
    `);
  }

  console.log("✅ Migrationen + Realtime-Trigger angewendet.");
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Migration fehlgeschlagen:", err);
  process.exit(1);
});
