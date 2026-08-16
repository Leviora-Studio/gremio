// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { formDocuments } from "@/lib/db/schema";
import { absPath, contentDisposition } from "@/lib/attachments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Öffentlicher Abruf eines Antragsformular-Dokuments (auf der Antragsseite
 * verlinkt). Bewusst ohne Auth — die Dateien sind öffentlich. PDF/Bilder werden
 * inline angezeigt, alles andere als Download (+ nosniff gegen MIME-Sniffing).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const docId = Number(id);
  if (!Number.isInteger(docId)) return new Response("Not found", { status: 404 });

  const [doc] = await db
    .select()
    .from(formDocuments)
    .where(eq(formDocuments.id, docId))
    .limit(1);
  if (!doc) return new Response("Not found", { status: 404 });

  let buf: Buffer;
  try {
    buf = await readFile(absPath(doc.path));
  } catch {
    return new Response("Datei fehlt", { status: 404 });
  }

  // Nur sichere, NICHT skriptfähige Typen inline anzeigen. SVG/HTML/XML würden
  // bei Inline-Auslieferung Skripte ausführen (nosniff hilft nicht, wenn der Typ
  // ehrlich als svg deklariert ist) → immer als Download.
  const INLINE_OK = new Set([
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
  ]);
  const inline = INLINE_OK.has(doc.mime);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": doc.mime || "application/octet-stream",
      "Content-Disposition": contentDisposition(
        doc.filename,
        inline ? "inline" : "attachment",
      ),
      "Content-Length": String(buf.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
    },
  });
}
