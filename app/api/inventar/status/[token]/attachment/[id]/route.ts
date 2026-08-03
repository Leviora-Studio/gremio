// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { readFile } from "node:fs/promises";
import { getLoanByToken } from "@/lib/inventory-loans";
import { getInventoryAttachmentById } from "@/lib/inventory-attachments";
import {
  PUBLIC_LOAN_ATTACHMENT_KINDS,
  type InventoryAttachmentKind,
} from "@/lib/inventory-attachment-kinds";
import { absPath, contentDisposition } from "@/lib/attachments";

export const dynamic = "force-dynamic";

// Öffentlich (per Token): nur Dateien, die an GENAU diesen Entleihvorgang
// gebunden sind UND auf der Whitelist stehen (Leihantrag/Leihvertrag) — nie
// interne Belege und insbesondere NIE der Studierendenausweis (`student_card`).
// Whitelist statt Blacklist: neue Anhangsarten sind damit per Default privat.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; id: string }> },
) {
  const { token, id } = await params;
  const loan = await getLoanByToken(token);
  if (!loan) return new Response("Not found", { status: 404 });

  const att = await getInventoryAttachmentById(Number(id));
  if (
    !att ||
    att.loanId !== loan.id ||
    !PUBLIC_LOAN_ATTACHMENT_KINDS.includes(att.kind as InventoryAttachmentKind)
  ) {
    return new Response("Not found", { status: 404 });
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
