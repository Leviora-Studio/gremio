// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardStatuses, cards } from "@/lib/db/schema";
import { todayInBerlin } from "@/lib/dates";

/**
 * Setzt Anweisungs- und/oder Überweisungsdatum auf heute, wenn die Zielspalte
 * als jeweiliger Trigger markiert ist und die Karte das Datum noch nicht hat.
 * Beide Trigger sind pro Board unabhängig konfigurierbar (board_statuses).
 */
export async function maybeSetTriggerDates(
  cardId: number,
  statusId: number,
): Promise<void> {
  const [st] = await db
    .select({
      instr: boardStatuses.isInstructionTrigger,
      transfer: boardStatuses.isTransferTrigger,
    })
    .from(boardStatuses)
    .where(eq(boardStatuses.id, statusId))
    .limit(1);
  if (!st) return;
  const today = todayInBerlin();
  if (st.instr) {
    await db
      .update(cards)
      .set({ instructionDate: today })
      .where(and(eq(cards.id, cardId), isNull(cards.instructionDate)));
  }
  if (st.transfer) {
    await db
      .update(cards)
      .set({ transferDate: today })
      .where(and(eq(cards.id, cardId), isNull(cards.transferDate)));
  }
}
