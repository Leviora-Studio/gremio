// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, cards } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { absPath } from "@/lib/attachments";
import { readPdfFields } from "@/lib/pdf-edit";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { isCardAttachmentVisible } from "@/lib/card-attachment-visibility";
import { parseApiId } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Ausfüllbare AcroForm-Felder eines PDF-Anhangs (für das Editor-Seitenpanel). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const attId = parseApiId(id);
  if (attId == null) return new Response("Not found", { status: 404 });

  const [att] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, attId))
    .limit(1);
  if (!att) return new Response("Not found", { status: 404 });

  const [card] = await db
    .select()
    .from(cards)
    .where(eq(cards.id, att.cardId))
    .limit(1);
  if (!card) return new Response("Not found", { status: 404 });

  const board = await getBoardById(card.boardId);
  if (!board || !(await canAccessBoard(user, board))) {
    return new Response("Forbidden", { status: 403 });
  }
  const visible = await getVisibleFieldKeys(board.id);
  if (!isCardAttachmentVisible(att, visible)) {
    return new Response("Not found", { status: 404 });
  }

  if (att.mime !== "application/pdf") {
    return NextResponse.json({ fields: [] });
  }

  let buf: Buffer;
  try {
    buf = await readFile(absPath(att.path));
  } catch {
    return new Response("Datei fehlt", { status: 404 });
  }

  let fields;
  try {
    fields = await readPdfFields(buf);
  } catch {
    return new Response("PDF-Formularfelder konnten nicht gelesen werden", {
      status: 422,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return NextResponse.json(
    { fields },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
