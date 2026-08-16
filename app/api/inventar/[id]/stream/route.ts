// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { getPublicInventoryBoardById } from "@/lib/inventory-public";
import { inventoryChangeSSE } from "@/lib/sse";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Live-Stream (SSE) der öffentlichen Inventar-Ansicht (nur freigegebene Boards). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const boardId = Number(id);
  const board = await getPublicInventoryBoardById(boardId);
  if (!board) return new Response("Not found", { status: 404 });

  return inventoryChangeSSE(request.signal, (c) => c.boardId === boardId);
}
