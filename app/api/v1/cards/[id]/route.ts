// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardStatuses } from "@/lib/db/schema";
import {
  apiError,
  authApi,
  requireWriteScope,
  serializeCard,
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
import { getAssigneeIds } from "@/lib/assignees";
import type { Board, Card } from "@/lib/db/schema";

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
  if (!/^\d+$/.test(id)) return apiError(404, "Karte nicht gefunden.");

  const loaded = await loadApiCard(ctx.user, Number(id));
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

  const [status] = await db
    .select({ name: boardStatuses.name })
    .from(boardStatuses)
    .where(eq(boardStatuses.id, r.card.statusId))
    .limit(1);

  const visible = await getVisibleFieldKeys(r.board.id);
  return NextResponse.json({
    card: serializeCard(
      r.card,
      {
        statusName: status?.name ?? "",
        boardName: r.board.name,
        assigneeUserIds: await getAssigneeIds(r.card.id),
      },
      visible,
    ),
  });
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
  return NextResponse.json({
    card: serializeCard(
      result.value,
      { assigneeUserIds: await getAssigneeIds(result.value.id) },
      visible,
    ),
  });
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

  await deleteCardViaApi(r.card.id);
  return NextResponse.json({ ok: true });
}
