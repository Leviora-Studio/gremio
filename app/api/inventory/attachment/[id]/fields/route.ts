// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  canAccessInventoryBoard,
  getInventoryBoardById,
} from "@/lib/inventory";
import { getInventoryItemById } from "@/lib/inventory-items";
import { getInventoryAttachmentById } from "@/lib/inventory-attachments";
import { absPath } from "@/lib/attachments";
import { readPdfFields } from "@/lib/pdf-edit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Ausfüllbare AcroForm-Felder eines Inventar-PDF-Anhangs (Editor-Seitenpanel). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const att = await getInventoryAttachmentById(Number(id));
  if (!att) return new Response("Not found", { status: 404 });

  const item = await getInventoryItemById(att.itemId);
  if (!item) return new Response("Not found", { status: 404 });
  const board = await getInventoryBoardById(item.boardId);
  if (!board || !(await canAccessInventoryBoard(user, board))) {
    return new Response("Forbidden", { status: 403 });
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

  const fields = await readPdfFields(buf);
  return NextResponse.json(
    { fields },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
