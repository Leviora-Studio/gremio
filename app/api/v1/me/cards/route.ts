// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  boardCardFields,
  boards,
  boardStatuses,
  cardAssignees,
  cards,
} from "@/lib/db/schema";
import { getAccessibleBoards } from "@/lib/authz";
import { getAssigneeIdsForCards } from "@/lib/assignees";
import { authApi, serializeCard, tokenAllowsBoard } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Alle dem Token-Nutzer zugewiesenen Karten, board-übergreifend. */
export async function GET(req: Request) {
  const ctx = await authApi(req);
  if (ctx instanceof NextResponse) return ctx;

  const accessible = (await getAccessibleBoards(ctx.user)).filter((b) =>
    tokenAllowsBoard(ctx, b.id),
  );
  const boardIds = accessible.map((b) => b.id);
  if (!boardIds.length) return NextResponse.json({ cards: [] });

  const archived = new URL(req.url).searchParams.get("archived");
  // Karten, in denen der Nutzer zu den Zugewiesenen gehört (n:m).
  const myCardIds = db
    .select({ id: cardAssignees.cardId })
    .from(cardAssignees)
    .where(eq(cardAssignees.userId, ctx.user.id));
  const conds = [
    inArray(cards.id, myCardIds),
    inArray(cards.boardId, boardIds),
  ];
  if (archived === "true") conds.push(isNotNull(cards.archivedAt));
  else if (archived !== "all") conds.push(isNull(cards.archivedAt));

  const rows = await db
    .select({
      card: cards,
      boardName: boards.name,
      statusName: boardStatuses.name,
    })
    .from(cards)
    .innerJoin(boards, eq(boards.id, cards.boardId))
    .innerJoin(boardStatuses, eq(boardStatuses.id, cards.statusId))
    .where(and(...conds))
    .orderBy(asc(boards.name), asc(boardStatuses.position), asc(cards.position));

  // Sichtbare Felder je Board (board-übergreifend) — deaktivierte Felder
  // werden je nach Board ausgeblendet (wie die jeweilige Web-Ansicht).
  const fieldRows = await db
    .select({ boardId: boardCardFields.boardId, fieldKey: boardCardFields.fieldKey })
    .from(boardCardFields)
    .where(
      and(
        inArray(boardCardFields.boardId, boardIds),
        eq(boardCardFields.visible, true),
      ),
    );
  const visibleByBoard = new Map<number, Set<string>>();
  for (const f of fieldRows) {
    const s = visibleByBoard.get(f.boardId) ?? new Set<string>();
    s.add(f.fieldKey);
    visibleByBoard.set(f.boardId, s);
  }

  const assigneeMap = await getAssigneeIdsForCards(rows.map((r) => r.card.id));

  return NextResponse.json({
    cards: rows.map((r) =>
      serializeCard(
        r.card,
        {
          statusName: r.statusName,
          boardName: r.boardName,
          assigneeUserIds: assigneeMap.get(r.card.id) ?? [],
        },
        visibleByBoard.get(r.card.boardId) ?? new Set<string>(),
      ),
    ),
  });
}
