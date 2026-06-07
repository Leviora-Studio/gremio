// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardStatuses, cards } from "@/lib/db/schema";
import { todayInBerlin } from "@/lib/dates";

/**
 * Setzt das Anweisungsdatum auf heute, wenn die Zielspalte als
 * Anweisungs-Trigger markiert ist und die Karte noch kein Datum hat.
 */
export async function maybeSetInstructionDate(
  cardId: number,
  statusId: number,
): Promise<void> {
  const [st] = await db
    .select({ trig: boardStatuses.isInstructionTrigger })
    .from(boardStatuses)
    .where(eq(boardStatuses.id, statusId))
    .limit(1);
  if (!st?.trig) return;
  const today = todayInBerlin();
  await db
    .update(cards)
    .set({ instructionDate: today })
    .where(and(eq(cards.id, cardId), isNull(cards.instructionDate)));
}
