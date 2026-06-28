// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { getCurrentUser } from "@/lib/auth";
import {
  canAccessInventoryBoard,
  getInventoryBoardById,
} from "@/lib/inventory";
import { inventoryChangeSSE } from "@/lib/sse";

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

  return inventoryChangeSSE(request.signal, (c) => c.boardId === boardId);
}
