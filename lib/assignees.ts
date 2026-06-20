// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { cardAssignees, users } from "@/lib/db/schema";

export type AssigneeUser = {
  id: number;
  username: string;
  name: string | null;
  avatarPath: string | null;
};

/** User-IDs der Zugewiesenen einer Karte. */
export async function getAssigneeIds(cardId: number): Promise<number[]> {
  const rows = await db
    .select({ userId: cardAssignees.userId })
    .from(cardAssignees)
    .where(eq(cardAssignees.cardId, cardId));
  return rows.map((r) => r.userId);
}

/** Zugewiesene Nutzer (mit Anzeige-Infos) einer Karte, alphabetisch. */
export async function getCardAssignees(cardId: number): Promise<AssigneeUser[]> {
  return db
    .select({
      id: users.id,
      username: users.username,
      name: users.name,
      avatarPath: users.avatarPath,
    })
    .from(cardAssignees)
    .innerJoin(users, eq(users.id, cardAssignees.userId))
    .where(eq(cardAssignees.cardId, cardId))
    .orderBy(asc(users.username));
}

/** cardId → Zugewiesene (mit Infos), für mehrere Karten in EINER Query. */
export async function getAssigneesForCards(
  cardIds: number[],
): Promise<Map<number, AssigneeUser[]>> {
  const map = new Map<number, AssigneeUser[]>();
  if (!cardIds.length) return map;
  const rows = await db
    .select({
      cardId: cardAssignees.cardId,
      id: users.id,
      username: users.username,
      name: users.name,
      avatarPath: users.avatarPath,
    })
    .from(cardAssignees)
    .innerJoin(users, eq(users.id, cardAssignees.userId))
    .where(inArray(cardAssignees.cardId, cardIds))
    .orderBy(asc(users.username));
  for (const r of rows) {
    const list = map.get(r.cardId) ?? [];
    list.push({ id: r.id, username: r.username, name: r.name, avatarPath: r.avatarPath });
    map.set(r.cardId, list);
  }
  return map;
}

/** cardId → User-IDs (für API-Serialisierung), für mehrere Karten. */
export async function getAssigneeIdsForCards(
  cardIds: number[],
): Promise<Map<number, number[]>> {
  const map = new Map<number, number[]>();
  if (!cardIds.length) return map;
  const rows = await db
    .select({ cardId: cardAssignees.cardId, userId: cardAssignees.userId })
    .from(cardAssignees)
    .where(inArray(cardAssignees.cardId, cardIds));
  for (const r of rows) {
    const list = map.get(r.cardId) ?? [];
    list.push(r.userId);
    map.set(r.cardId, list);
  }
  return map;
}

/**
 * Setzt die Zuweisungen einer Karte exakt auf `userIds`. Gibt die Differenz
 * (hinzugefügte/entfernte User-IDs) zurück — für das Aktivitätslog. Validiert
 * NICHT gegen Board-Mitglieder; das macht der Aufrufer (wie bisher bei assignee).
 */
export async function setCardAssignees(
  cardId: number,
  userIds: number[],
): Promise<{ added: number[]; removed: number[] }> {
  const target = [...new Set(userIds)];
  // Lesen + Löschen + Einfügen atomar, sonst könnten zwei gleichzeitige
  // Speichervorgänge auf derselben Karte verschränken und einen Endzustand
  // erzeugen, der zu keiner der beiden Anfragen passt.
  return db.transaction(async (tx) => {
    const current = (
      await tx
        .select({ userId: cardAssignees.userId })
        .from(cardAssignees)
        .where(eq(cardAssignees.cardId, cardId))
    ).map((r) => r.userId);
    const curSet = new Set(current);
    const tgtSet = new Set(target);
    const added = target.filter((id) => !curSet.has(id));
    const removed = current.filter((id) => !tgtSet.has(id));
    if (removed.length) {
      await tx
        .delete(cardAssignees)
        .where(
          and(
            eq(cardAssignees.cardId, cardId),
            inArray(cardAssignees.userId, removed),
          ),
        );
    }
    if (added.length) {
      await tx
        .insert(cardAssignees)
        .values(added.map((userId) => ({ cardId, userId })))
        .onConflictDoNothing();
    }
    return { added, removed };
  });
}
