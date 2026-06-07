// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { Client } from "pg";
import { EventEmitter } from "node:events";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";

export type CardChange = { boardId: number | null; token: string | null };

/**
 * Installiert (idempotent) einen Postgres-Trigger, der bei JEDER Änderung an
 * `cards` (INSERT/UPDATE/DELETE) ein NOTIFY auf dem Kanal `card_change`
 * auslöst — mit board_id und token im Payload. Da alle Karten-Änderungen
 * `updated_at` bumpen (auch Anhänge & öffentliches Einreichen), deckt das den
 * gesamten Live-Update-Bedarf ab. Wird beim Start nach den Migrationen
 * aufgerufen.
 */
export async function ensureCardChangeTrigger(): Promise<void> {
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
}

// --- LISTEN-Singleton (eine dedizierte Verbindung je App-Instanz) ----------
// Eine eigene pg-Verbindung (nicht aus dem Pool, da dauerhaft im LISTEN-Modus).
// Notifications werden über einen In-Process-EventEmitter an alle offenen
// SSE-Streams verteilt. Über globalThis abgesichert gegen Dev-HMR-Duplikate.
const g = globalThis as unknown as {
  __cardEmitter?: EventEmitter;
  __cardListenerStarted?: boolean;
};

const emitter: EventEmitter = (g.__cardEmitter ??= new EventEmitter());
emitter.setMaxListeners(0); // unbegrenzt viele SSE-Clients

function startListener(): void {
  if (g.__cardListenerStarted) return;
  g.__cardListenerStarted = true;

  const connect = (): void => {
    const client = new Client({ connectionString: env.DATABASE_URL });
    let downed = false;
    const down = () => {
      if (downed) return;
      downed = true;
      try {
        client.removeAllListeners();
        void client.end().catch(() => {});
      } catch {
        /* ignore */
      }
      setTimeout(connect, 2000); // Reconnect mit Backoff
    };

    client.on("notification", (msg) => {
      if (msg.channel !== "card_change" || !msg.payload) return;
      try {
        emitter.emit("change", JSON.parse(msg.payload) as CardChange);
      } catch {
        /* ignore */
      }
    });
    client.on("error", down);
    client.on("end", down);

    client
      .connect()
      .then(() => client.query("LISTEN card_change"))
      .catch(down);
  };

  connect();
}

/** Abonniert Karten-Änderungen; gibt eine Abmelde-Funktion zurück. */
export function subscribeCardChanges(cb: (c: CardChange) => void): () => void {
  startListener();
  emitter.on("change", cb);
  return () => {
    emitter.off("change", cb);
  };
}
