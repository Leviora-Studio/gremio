// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { boardInstructionForms } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBoard, canManageBoard, getBoardById } from "@/lib/authz";
import { absPath } from "@/lib/attachments";
import { readPdfFields } from "@/lib/pdf-edit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const boardId = Number(id);
  if (!Number.isInteger(boardId)) return new Response("Not found", { status: 404 });
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

  return NextResponse.json(
    { fields: await readPdfFields(pdf) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
