// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { activeRows } from "@/lib/trash-visibility";
import { and as trashAnd } from "drizzle-orm";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardNumbering, cards } from "@/lib/db/schema";

import { buildCardNumber } from "./numbering-format";
export { buildCardNumber } from "./numbering-format";
export type { NumberingConfig } from "./numbering-format";

/**
 * Inventarnummer: Präfix, Jahr, dann die (aufgefüllte) Ziffer — in genau dieser
 * Reihenfolge, verbunden mit dem Trennzeichen. Leere Blöcke (Präfix/Jahr) werden
 * übersprungen. z. B. Präfix "INV", Jahr "2026", padding 3 → "INV_2026_005".
 */
export function buildInventoryNumber(
  cfg: { prefix: string; year: string; separator: string; padding: number },
  counter: number,
): string {
  const num =
    cfg.padding > 0 ? String(counter).padStart(cfg.padding, "0") : String(counter);
  const parts = [cfg.prefix, cfg.year, num].filter((p) => p !== "");
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
    .where(trashAnd(activeRows.cards, eq(cards.id, cardId)))
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
