// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardStatuses, cards } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { doneSinceForStatus } from "@/lib/done-archive";

/** Holt eine archivierte Karte zurück aufs Board (erste Spalte, ans Ende). */
export async function restoreCardAction(
  boardId: number,
  cardId: number,
): Promise<void> {
  const user = await requireUser();
  const board = await getBoardById(boardId);
  if (!board || !(await canAccessBoard(user, board))) return;

  const [card] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.id, cardId), eq(cards.boardId, boardId)))
    .limit(1);
  if (!card) return;

  const [first] = await db
    .select({ id: boardStatuses.id })
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, boardId))
    .orderBy(asc(boardStatuses.position))
    .limit(1);
  if (!first) return;

  const [maxRow] = await db
    .select({ m: sql<number>`coalesce(max(${cards.position}), -1)` })
    .from(cards)
    .where(
      and(
        eq(cards.boardId, boardId),
        eq(cards.statusId, first.id),
        isNull(cards.archivedAt),
      ),
    );
  const position = (maxRow?.m ?? -1) + 1;

  await db
    .update(cards)
    .set({
      archivedAt: null,
      statusId: first.id,
      position,
      doneSince: doneSinceForStatus(board.doneStatusId, first.id, null),
      updatedAt: new Date(),
    })
    .where(eq(cards.id, cardId));

  revalidatePath(`/intern/board/${boardId}/archiv`);
  revalidatePath(`/intern/board/${boardId}`);
}
