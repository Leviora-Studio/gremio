// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { boardInstructionForms } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBoard, canManageBoard, getBoardById } from "@/lib/authz";
import { absPath, contentDisposition } from "@/lib/attachments";
import { parseApiId } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const boardId = parseApiId(id);
  if (boardId == null) return new Response("Not found", { status: 404 });
  const board = await getBoardById(boardId);
  if (!board || !(await canAccessBoard(user, board))) {
    return new Response("Forbidden", { status: 403 });
  }

  const [config] = await db
    .select()
    .from(boardInstructionForms)
    .where(eq(boardInstructionForms.boardId, boardId))
    .limit(1);
  if (!config || (!config.enabled && !canManageBoard(user, board))) {
    return new Response("Not found", { status: 404 });
  }

  let pdf: Buffer;
  try {
    pdf = await readFile(absPath(config.path));
  } catch {
    return new Response("Datei fehlt", { status: 404 });
  }

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition(config.filename, "inline"),
      "Content-Length": String(pdf.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
