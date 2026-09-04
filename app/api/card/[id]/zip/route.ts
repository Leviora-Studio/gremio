// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile } from "node:fs/promises";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, cards } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import { absPath, contentDisposition } from "@/lib/attachments";
import { ZIP_MAX_TOTAL_BYTES } from "@/lib/constants";
import { zip } from "@/lib/zip";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { isCardAttachmentVisible } from "@/lib/card-attachment-visibility";
import { parseApiId } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Eindeutiger Eintragsname im ZIP (Duplikate → „name (2).ext"). */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  let cand = "";
  do {
    cand = `${base} (${i++})${ext}`;
  } while (used.has(cand));
  used.add(cand);
  return cand;
}

const safeName = (name: string) =>
  (name || "datei")
    .replace(/[\\/\r\n]+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 150) || "datei";

/** Alle Anhänge einer Karte als ZIP (Dateiname = Antragsnummer, sonst Titel). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const cardId = parseApiId(id);
  if (cardId == null) return new Response("Not found", { status: 404 });

  const [card] = await db
    .select()
    .from(cards)
    .where(eq(cards.id, cardId))
    .limit(1);
  if (!card) return new Response("Not found", { status: 404 });

  const board = await getBoardById(card.boardId);
  if (!board || !(await canAccessBoard(user, board))) {
    return new Response("Forbidden", { status: 403 });
  }

  const visible = await getVisibleFieldKeys(board.id);
  const atts = (
    await db
    .select()
    .from(attachments)
    .where(eq(attachments.cardId, cardId))
    .orderBy(asc(attachments.uploadedAt))
  ).filter((attachment) => isCardAttachmentVisible(attachment, visible));

  const used = new Set<string>();
  const files: { name: string; data: Buffer }[] = [];
  let total = 0;
  for (const a of atts) {
    try {
      const data = await readFile(absPath(a.path));
      total += data.length;
      if (total > ZIP_MAX_TOTAL_BYTES) {
        // Alles wird im Speicher gepackt → Gesamtgröße deckeln (RAM-/Zip64-Schutz).
        return new Response(
          "Die Dokumente sind zu groß für ein gemeinsames ZIP.",
          { status: 413 },
        );
      }
      files.push({ name: uniqueName(safeName(a.filename), used), data });
    } catch {
      // Datei fehlt physisch — überspringen
    }
  }
  if (!files.length) {
    return new Response("Keine Dokumente vorhanden", { status: 404 });
  }

  const base =
    ((visible.has("number") ? card.number?.trim() : null) ||
      card.title?.trim() ||
      "Dokumente")
      .replace(/[\\/:*?"<>|\r\n]+/g, "_")
      .slice(0, 120) || "Dokumente";

  let zipBuf: Buffer;
  try {
    zipBuf = zip(files);
  } catch {
    return new Response("ZIP konnte nicht erstellt werden (zu groß).", {
      status: 413,
    });
  }
  return new Response(new Uint8Array(zipBuf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": contentDisposition(`${base}.zip`, "attachment"),
      "Content-Length": String(zipBuf.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
