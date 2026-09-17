// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import {
  authApi,
  apiError,
  parseApiId,
  requireWriteScope,
  tokenAllowsBoard,
} from "@/lib/api";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { loadApiCard } from "@/lib/api-cards";

export async function resolveApiBoard(req: Request, id: string, write = false) {
  const ctx = await authApi(req);
  if (ctx instanceof NextResponse) return ctx;
  const boardId = parseApiId(id);
  const board = boardId == null ? null : await getBoardById(boardId);
  if (
    !board ||
    !tokenAllowsBoard(ctx, board.id) ||
    !(await canAccessBoard(ctx.user, board))
  )
    return apiError(404, "Board nicht gefunden.");
  if (write) {
    const denied = requireWriteScope(ctx);
    if (denied) return denied;
    if (board.inventoryBoardId != null)
      return apiError(409, "Leihvorgang-Board: API nur lesend.");
  }
  return { ctx, board };
}

export async function resolveApiCard(req: Request, id: string, write = false) {
  const ctx = await authApi(req);
  if (ctx instanceof NextResponse) return ctx;
  const cardId = parseApiId(id);
  if (cardId == null) return apiError(404, "Karte nicht gefunden.");
  const loaded = await loadApiCard(ctx.user, cardId);
  if (!loaded.ok || !tokenAllowsBoard(ctx, loaded.value.board.id))
    return apiError(404, "Karte nicht gefunden.");
  if (write) {
    const denied = requireWriteScope(ctx);
    if (denied) return denied;
    if (loaded.value.board.inventoryBoardId != null)
      return apiError(409, "Leihvorgang-Board: API nur lesend.");
  }
  return { ctx, ...loaded.value };
}
