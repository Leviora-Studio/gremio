// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardCardFields, boardStatuses } from "@/lib/db/schema";
import { canAccessBoard, canManageBoard, getBoardById } from "@/lib/authz";
import {
  apiError,
  authApi,
  serializeBoard,
  serializeStatus,
  tokenAllowsBoard,
} from "@/lib/api";

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

  const statuses = await db
    .select()
    .from(boardStatuses)
    .where(eq(boardStatuses.boardId, board.id))
    .orderBy(asc(boardStatuses.position));

  const fields = await db
    .select({ k: boardCardFields.fieldKey })
    .from(boardCardFields)
    .where(
      and(
        eq(boardCardFields.boardId, board.id),
        eq(boardCardFields.visible, true),
      ),
    )
    .orderBy(asc(boardCardFields.position));

  const canManage = canManageBoard(ctx.user, board);
  return NextResponse.json({
    board: serializeBoard(board, ctx.user),
    statuses: statuses.map((s) => serializeStatus(s, canManage)),
    visibleFields: fields.map((f) => f.k),
  });
}
