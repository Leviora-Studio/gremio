// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile } from "node:fs/promises";
import { getCurrentUser } from "@/lib/auth";
import {
  canAccessInventoryBoard,
  getInventoryBoardById,
} from "@/lib/inventory";
import { getInventoryItemById } from "@/lib/inventory-items";
import { getInventoryAttachmentById } from "@/lib/inventory-attachments";
import { absPath, contentDisposition } from "@/lib/attachments";

export const dynamic = "force-dynamic";

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

  let buf: Buffer;
  try {
    buf = await readFile(absPath(att.path));
  } catch {
    return new Response("Datei fehlt", { status: 404 });
  }

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": att.mime,
      "Content-Disposition": contentDisposition(att.filename, "inline"),
      "Content-Length": String(buf.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
