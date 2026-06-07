// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, attachments } from "@/lib/db/schema";
import { absPath } from "@/lib/attachments";
import { PUBLIC_ATTACHMENT_KINDS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const PUBLIC = new Set<string>(PUBLIC_ATTACHMENT_KINDS);

/**
 * Öffentlicher Datei-Abruf über den Status-Token.
 * Liefert nur Anhänge, die (a) zum Antrag mit diesem Token gehören und
 * (b) ein öffentlich sichtbarer Typ sind (kein Studierendenausweis).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const attId = Number(id);
  if (!Number.isInteger(attId)) return new Response("Not found", { status: 404 });

  const [row] = await db
    .select({ att: attachments, cardToken: cards.token })
    .from(attachments)
    .innerJoin(cards, eq(cards.id, attachments.cardId))
    .where(eq(attachments.id, attId))
    .limit(1);

  if (!row || row.cardToken !== token || !PUBLIC.has(row.att.kind)) {
    return new Response("Not found", { status: 404 });
  }

  let buf: Buffer;
  try {
    buf = await readFile(absPath(row.att.path));
  } catch {
    return new Response("Datei fehlt", { status: 404 });
  }

  const safeName = row.att.filename.replace(/[\r\n"\\]/g, "_");
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": row.att.mime,
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Content-Length": String(buf.length),
      "X-Content-Type-Options": "nosniff",
      // Token-gebundene Datei nie in Browser-/Proxy-Caches ablegen.
      "Cache-Control": "private, no-store",
    },
  });
}
