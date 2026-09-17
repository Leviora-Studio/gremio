// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { resolveApiBoard } from "@/lib/api-access";
import { queryApiCards } from "@/lib/api-query";
import { NextResponse } from "next/server";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import {
  apiError,
  authApi,
  parseApiId,
  requireWriteScope,
  tokenAllowsBoard,
} from "@/lib/api";
import { cardWriteSchema, createCardViaApi } from "@/lib/api-cards";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { serializeApiCardDetail } from "@/lib/api-card-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const r = await resolveApiBoard(req, (await params).id);
  if (r instanceof NextResponse) return r;
  return queryApiCards(req, r.ctx, { boardId: r.board.id });
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
  const boardId = parseApiId(id);
  if (boardId == null) return apiError(404, "Board nicht gefunden.");
  const board = await getBoardById(boardId);
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
  const detail = await serializeApiCardDetail(result.value.id, visible);
  return detail
    ? NextResponse.json(detail, { status: 201 })
    : apiError(404, "Karte nicht gefunden.");
}
