// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { NextResponse } from "next/server";
import {
  apiError,
  authApi,
  requireWriteScope,
  parseApiId,
  tokenAllowsBoard,
  type ApiContext,
} from "@/lib/api";
import {
  cardWriteSchema,
  deleteCardViaApi,
  loadApiCard,
  updateCardViaApi,
} from "@/lib/api-cards";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import type { Board, Card } from "@/lib/db/schema";
import { serializeApiCardDetail } from "@/lib/api-card-response";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Auth + Karte laden + Board-Scope prüfen. Liefert 401/404 oder den Kontext. */
async function resolve(
  req: Request,
  id: string,
): Promise<
  NextResponse | { ctx: ApiContext; board: Board; card: Card }
> {
  const ctx = await authApi(req);
  if (ctx instanceof NextResponse) return ctx;
  const cardId = parseApiId(id);
  if (cardId == null) return apiError(404, "Karte nicht gefunden.");

  const loaded = await loadApiCard(ctx.user, cardId);
  if (!loaded.ok) return apiError(loaded.status, loaded.error);
  if (!tokenAllowsBoard(ctx, loaded.value.board.id))
    return apiError(404, "Karte nicht gefunden.");
  return { ctx, board: loaded.value.board, card: loaded.value.card };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await resolve(req, id);
  if (r instanceof NextResponse) return r;

  const visible = await getVisibleFieldKeys(r.board.id);
  const detail = await serializeApiCardDetail(r.card.id, visible, r.board.name);
  return detail ? NextResponse.json(detail) : apiError(404, "Karte nicht gefunden.");
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await resolve(req, id);
  if (r instanceof NextResponse) return r;
  const denied = requireWriteScope(r.ctx);
  if (denied) return denied;
  if (r.board.inventoryBoardId != null) {
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

  const result = await updateCardViaApi(r.ctx.user, r.board, r.card, parsed.data);
  if (!result.ok) return apiError(result.status, result.error);
  const visible = await getVisibleFieldKeys(r.board.id);
  const detail = await serializeApiCardDetail(result.value.id, visible);
  return detail ? NextResponse.json(detail) : apiError(404, "Karte nicht gefunden.");
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const r = await resolve(req, id);
  if (r instanceof NextResponse) return r;
  const denied = requireWriteScope(r.ctx);
  if (denied) return denied;
  if (r.board.inventoryBoardId != null) {
    return apiError(
      409,
      "Leihvorgang-Board: Karten werden über das Inventar verwaltet (API nur lesend).",
    );
  }

  await deleteCardViaApi(r.card.id);
  return NextResponse.json({ ok: true });
}
