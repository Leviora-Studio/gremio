// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardNumbering, cards } from "@/lib/db/schema";

export type NumberingConfig = {
  prefix: string;
  year: string;
  code: string;
  separator: string;
  padding: number;
};

/**
 * Setzt die Antragsnummer zusammen: Präfix+Zahl werden zusammengeklebt,
 * danach Jahr und Kürzel als weitere Blöcke. Nur nicht-leere Blöcke werden
 * mit dem Trennzeichen verbunden (keine doppelten/überflüssigen Trenner).
 */
export function buildCardNumber(cfg: NumberingConfig, counter: number): string {
  const num =
    cfg.padding > 0 ? String(counter).padStart(cfg.padding, "0") : String(counter);
  const head = `${cfg.prefix}${num}`;
  const parts = [head, cfg.year, cfg.code].filter((p) => p !== "");
  return parts.join(cfg.separator);
}

// Drizzle-Transaktionshandle (für „in bestehender Transaktion mitlaufen").
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Wie assignCardNumber, läuft aber in einer bereits geöffneten Transaktion mit
 * (damit Karten-Anlage + Nummernvergabe atomar sein können).
 */
export async function assignCardNumberTx(
  tx: Tx,
  boardId: number,
  cardId: number,
): Promise<string | null> {
  const [card] = await tx
    .select({ number: cards.number })
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!card) return null; // Karte weg
  if (card.number) return card.number; // schon nummeriert

  const [cfg] = await tx
    .update(boardNumbering)
    .set({ next: sql`${boardNumbering.next} + 1` })
    .where(
      and(eq(boardNumbering.boardId, boardId), eq(boardNumbering.enabled, true)),
    )
    .returning({
      assigned: sql<number>`${boardNumbering.next} - 1`,
      prefix: boardNumbering.prefix,
      year: boardNumbering.year,
      code: boardNumbering.code,
      separator: boardNumbering.separator,
      padding: boardNumbering.padding,
    });
  if (!cfg) return null; // Nummerierung aus

  const number = buildCardNumber(cfg, cfg.assigned);
  await tx.update(cards).set({ number }).where(eq(cards.id, cardId));
  return number;
}

/**
 * Zieht atomar die nächste Nummer für das Board und schreibt sie auf die Karte
 * — nur wenn die Nummerierung aktiv ist UND die Karte noch keine Nummer hat.
 * Der zeilensperrende UPDATE serialisiert gleichzeitige Vergaben.
 */
export async function assignCardNumber(
  boardId: number,
  cardId: number,
): Promise<string | null> {
  return db.transaction((tx) => assignCardNumberTx(tx, boardId, cardId));
}
