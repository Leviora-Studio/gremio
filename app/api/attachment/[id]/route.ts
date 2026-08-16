// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, attachments } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { absPath, contentDisposition } from "@/lib/attachments";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const attId = Number(id);
  if (!Number.isInteger(attId)) return new Response("Not found", { status: 404 });
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
      // Interne Anhänge (inkl. Studierendenausweis) nie in Browser-/Proxy-Caches.
      "Cache-Control": "private, no-store",
    },
  });
}
