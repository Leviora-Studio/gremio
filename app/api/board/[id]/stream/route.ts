// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { getCurrentUser, resolveSessionUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { cardChangeSSE } from "@/lib/sse";

import { getSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Live-Stream (SSE) der Karten-Änderungen eines Boards. Nur mit Board-Zugriff. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const boardId = Number(id);
  const board = await getBoardById(boardId);
  if (!board || !(await canAccessBoard(user, board))) {
    return new Response("Forbidden", { status: 403 });
  }

  const session = await getSession();
  return cardChangeSSE(request.signal, (c) => c.boardId === boardId, async () => {
    const current = await resolveSessionUser(session);const currentBoard = await getBoardById(boardId);
    return !!current && !!currentBoard && await canAccessBoard(current,currentBoard);
  });
}
