// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

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

// ===========================================================================
// Inventar-Realtime (analog zu den Karten) — Kanal `inventory_change`.
// Änderungen an Gegenständen, Vorgängen, Mängeln und Dateien lösen ein NOTIFY
// mit boardId (+ ggf. token des Vorgangs) aus.
// ===========================================================================

export type InventoryChange = { boardId: number | null; token: string | null };

/**
 * Installiert (idempotent) Trigger auf allen Inventar-Tabellen, die bei jeder
 * Änderung ein NOTIFY auf `inventory_change` auslösen. boardId/token werden je
 * Tabelle aufgelöst (Vorgänge/Mängel/Dateien hängen über item_id am Board).
 */
export async function ensureInventoryChangeTrigger(): Promise<void> {
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
}

const gi = globalThis as unknown as {
  __invEmitter?: EventEmitter;
  __invListenerStarted?: boolean;
};
const invEmitter: EventEmitter = (gi.__invEmitter ??= new EventEmitter());
invEmitter.setMaxListeners(0);

function startInventoryListener(): void {
  if (gi.__invListenerStarted) return;
  gi.__invListenerStarted = true;

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
      setTimeout(connect, 2000);
    };
    client.on("notification", (msg) => {
      if (msg.channel !== "inventory_change" || !msg.payload) return;
      try {
        invEmitter.emit("change", JSON.parse(msg.payload) as InventoryChange);
      } catch {
        /* ignore */
      }
    });
    client.on("error", down);
    client.on("end", down);
    client
      .connect()
      .then(() => client.query("LISTEN inventory_change"))
      .catch(down);
  };

  connect();
}

/** Abonniert Inventar-Änderungen; gibt eine Abmelde-Funktion zurück. */
export function subscribeInventoryChanges(
  cb: (c: InventoryChange) => void,
): () => void {
  startInventoryListener();
  invEmitter.on("change", cb);
  return () => {
    invEmitter.off("change", cb);
  };
}
