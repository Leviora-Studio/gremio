// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

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

  console.log("✅ Migrationen + Realtime-Trigger angewendet.");
  await pool.end();
}

main().catch((err) => {
  console.error("❌ Migration fehlgeschlagen:", err);
  process.exit(1);
});
