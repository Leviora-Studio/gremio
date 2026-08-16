// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { and, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { boards, cards } from "@/lib/db/schema";

/**
 * Berechnet den letzten Zeitpunkt „HH:MM" am oder vor `now` (lokale Zeit).
 * Karten, die seit vor diesem Zeitpunkt in der Done-Spalte liegen, werden
 * archiviert — so lebt jede erledigte Karte bis zum nächsten „Tageswechsel".
 */
export function sweepCutoff(sweepTime: string, now: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(sweepTime.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  const todayT = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    h,
    min,
    0,
    0,
  );
  return now.getTime() >= todayT.getTime()
    ? todayT
    : new Date(todayT.getTime() - 24 * 60 * 60 * 1000);
}

/** Setzt/entfernt done_since beim Spaltenwechsel. */
export function doneSinceForStatus(
  doneStatusId: number | null,
  newStatusId: number,
  current: Date | null,
): Date | null {
  if (doneStatusId != null && newStatusId === doneStatusId) {
    return current ?? new Date();
  }
  return null;
}

/**
 * Archiviert (blendet aus) alle fälligen Karten in den Done-Spalten aller
 * Boards. Idempotent — bereits archivierte Karten werden übersprungen. Das
 * UPDATE löst den cards-NOTIFY-Trigger aus → Boards aktualisieren sich live.
 */
export async function sweepDoneColumns(now: Date = new Date()): Promise<number> {
  const list = await db
    .select({
      id: boards.id,
      doneStatusId: boards.doneStatusId,
      doneSweepTime: boards.doneSweepTime,
    })
    .from(boards)
    .where(and(isNotNull(boards.doneStatusId), isNotNull(boards.doneSweepTime)));

  let archived = 0;
  for (const b of list) {
    const cutoff = sweepCutoff(b.doneSweepTime!, now);
    if (!cutoff) continue;
    const res = await db
      .update(cards)
      .set({ archivedAt: now })
      .where(
        and(
          eq(cards.boardId, b.id),
          eq(cards.statusId, b.doneStatusId!),
          isNull(cards.archivedAt),
          isNotNull(cards.doneSince),
          lte(cards.doneSince, cutoff),
        ),
      )
      .returning({ id: cards.id });
    archived += res.length;
  }
  if (archived > 0) {
    console.log(`[done-archive] ${archived} erledigte Karte(n) archiviert.`);
  }
  return archived;
}

// --- Scheduler (eine Instanz je Prozess) -----------------------------------
const g = globalThis as unknown as { __doneSchedulerStarted?: boolean };

/** Startet den Minuten-Scheduler (idempotent). */
export function startDoneArchiveScheduler(): void {
  if (g.__doneSchedulerStarted) return;
  g.__doneSchedulerStarted = true;
  const tick = () => {
    sweepDoneColumns().catch((e) =>
      console.error("[done-archive] Sweep fehlgeschlagen:", e),
    );
  };
  // Beim Start einmal laufen, danach jede Minute.
  tick();
  setInterval(tick, 60 * 1000);
}
