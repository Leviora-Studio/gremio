// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardStatuses, cards } from "@/lib/db/schema";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import {
  apiError,
  authApi,
  requireWriteScope,
  serializeCard,
  tokenAllowsBoard,
} from "@/lib/api";
import { cardWriteSchema, createCardViaApi } from "@/lib/api-cards";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { getAssigneeIds, getAssigneeIdsForCards } from "@/lib/assignees";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authApi(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;
  const board = await getBoardById(Number(id));
  if (
    !board ||
    !tokenAllowsBoard(ctx, board.id) ||
    !(await canAccessBoard(ctx.user, board))
  )
    return apiError(404, "Board nicht gefunden.");

  const sp = new URL(req.url).searchParams;
  const statusFilter = sp.get("statusId");
  const archived = sp.get("archived"); // "true" | "all" | sonst = nur aktive
  const conds = [eq(cards.boardId, board.id)];
  if (statusFilter && /^\d+$/.test(statusFilter)) {
    conds.push(eq(cards.statusId, Number(statusFilter)));
  }
  if (archived === "true") conds.push(isNotNull(cards.archivedAt));
  else if (archived !== "all") conds.push(isNull(cards.archivedAt));

  const rows = await db
    .select({ card: cards, statusName: boardStatuses.name })
    .from(cards)
    .innerJoin(boardStatuses, eq(boardStatuses.id, cards.statusId))
    .where(and(...conds))
    .orderBy(asc(boardStatuses.position), asc(cards.position), asc(cards.id));

  const visible = await getVisibleFieldKeys(board.id);
  const assigneeMap = await getAssigneeIdsForCards(rows.map((r) => r.card.id));
  return NextResponse.json({
    cards: rows.map((r) =>
      serializeCard(
        r.card,
        {
          statusName: r.statusName,
          assigneeUserIds: assigneeMap.get(r.card.id) ?? [],
        },
        visible,
      ),
    ),
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await authApi(req);
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireWriteScope(ctx);
  if (denied) return denied;

  const { id } = await params;
  const board = await getBoardById(Number(id));
  if (
    !board ||
    !tokenAllowsBoard(ctx, board.id) ||
    !(await canAccessBoard(ctx.user, board))
  )
    return apiError(404, "Board nicht gefunden.");
  // Leihvorgang-System-Boards werden ausschließlich über das Inventar verwaltet
  // (die Web-UI leitet Karten dort in die Leih-Ansicht) → API nur lesend.
  if (board.inventoryBoardId != null) {
    return apiError(
      409,
      "Leihvorgang-Board: Karten werden über das Inventar verwaltet (API nur lesend).",
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "Body muss gültiges JSON sein.");
  }
  const parsed = cardWriteSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(400, "Ungültige Eingabe.", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }

  const result = await createCardViaApi(ctx.user, board, parsed.data);
  if (!result.ok) return apiError(result.status, result.error);
  const visible = await getVisibleFieldKeys(board.id);
  return NextResponse.json(
    {
      card: serializeCard(
        result.value,
        { assigneeUserIds: await getAssigneeIds(result.value.id) },
        visible,
      ),
    },
    { status: 201 },
  );
}
