// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { getCurrentUser, resolveSessionUser } from "@/lib/auth";
import {
  canAccessInventoryBoard,
  getInventoryBoardById,
} from "@/lib/inventory";
import { inventoryChangeSSE } from "@/lib/sse";

import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Live-Stream (SSE) der Inventar-Änderungen eines Boards. Nur mit Zugriff. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const boardId = Number(id);
  const board = await getInventoryBoardById(boardId);
  if (!board || !(await canAccessInventoryBoard(user, board))) {
    return new Response("Forbidden", { status: 403 });
  }

  const session = await getSession();
  return inventoryChangeSSE(request.signal, (c) => c.boardId === boardId, async () => {
    const current = await resolveSessionUser(session);const currentBoard = await getInventoryBoardById(boardId);
    return !!current && !!currentBoard && await canAccessInventoryBoard(current,currentBoard);
  });
}
