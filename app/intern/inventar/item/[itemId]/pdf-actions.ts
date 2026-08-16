// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

"use server";

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { inventoryAttachments } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import {
  canAccessInventoryBoard,
  getInventoryBoardById,
} from "@/lib/inventory";
import { getInventoryItemById } from "@/lib/inventory-items";
import { getInventoryAttachmentById } from "@/lib/inventory-attachments";
import { absPath, deleteStoredFile, saveNamedBuffer } from "@/lib/attachments";
import { allowRequest } from "@/lib/rate-limit";
import { applyEditsAndSign } from "@/lib/pdf-apply";
import type {
  SavePdfInput,
  SavePdfResult,
} from "@/app/intern/card/[id]/pdf-actions";

function withSuffix(filename: string, suffix: string): string {
  const dot = filename.toLowerCase().lastIndexOf(".pdf");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}_${suffix}.pdf`.slice(0, 180);
}

/**
 * Speichert die im In-App-Viewer vorgenommenen PDF-Änderungen (Freitext +
 * Formularfelder) und optional eine Signatur — für Inventar-Anhänge. „new"
 * legt eine zusätzliche Datei am selben Gegenstand/Vorgang an, „replace"
 * ersetzt in-place. Board-Zugriff erforderlich. Gleiche Signatur wie der
 * Karten-Speicherpfad, damit der PdfEditor beide nutzen kann.
 */
export async function saveInventoryPdfEditsAction(
  input: SavePdfInput,
): Promise<SavePdfResult> {
  const user = await requireUser();
  if (!input || !Number.isInteger(input.attachmentId)) {
    return { ok: false, error: "Ungültige Eingabe." };
  }
  if (!(await allowRequest(`pdf-save:${user.id}`, 30, 60_000))) {
    return { ok: false, error: "Zu viele Anfragen. Bitte kurz warten." };
  }
  const mode = input.mode === "replace" ? "replace" : "new";

  const att = await getInventoryAttachmentById(input.attachmentId);
  if (!att) return { ok: false, error: "Anhang nicht gefunden." };
  if (att.mime !== "application/pdf") {
    return { ok: false, error: "Nur PDF-Dateien können bearbeitet werden." };
  }
  const item = await getInventoryItemById(att.itemId);
  if (!item) return { ok: false, error: "Gegenstand nicht gefunden." };
  const board = await getInventoryBoardById(item.boardId);
  if (!board || !(await canAccessInventoryBoard(user, board))) {
    return { ok: false, error: "Kein Zugriff." };
  }

  let pdf: Buffer;
  try {
    pdf = await readFile(absPath(att.path));
  } catch {
    return { ok: false, error: "Originaldatei nicht lesbar." };
  }

  const result = await applyEditsAndSign(user, input, pdf);
  if (!result.ok) return result;
  const { pdf: outPdf, signed, warning } = result;
  const noun = signed ? "signiert" : "bearbeitet";
  const subdir = join("inventory", String(item.id));

  if (mode === "replace") {
    const saved = await saveNamedBuffer(
      subdir,
      att.filename,
      outPdf,
      "application/pdf",
    );
    const oldPath = att.path;
    await db
      .update(inventoryAttachments)
      .set({
        path: saved.relPath,
        size: saved.size,
        mime: "application/pdf",
        uploadedAt: new Date(),
        uploadedBy: user.id,
      })
      .where(eq(inventoryAttachments.id, att.id));
    await deleteStoredFile(oldPath);
    revalidatePath(`/intern/inventar/item/${item.id}`);
    return { ok: true, attachmentId: att.id, signed, warning };
  }

  const newName = withSuffix(att.filename, noun);
  const saved = await saveNamedBuffer(
    subdir,
    newName,
    outPdf,
    "application/pdf",
  );
  const [ins] = await db
    .insert(inventoryAttachments)
    .values({
      itemId: item.id,
      loanId: att.loanId,
      kind: att.kind,
      filename: newName,
      path: saved.relPath,
      mime: "application/pdf",
      size: saved.size,
      uploadedBy: user.id,
    })
    .returning({ id: inventoryAttachments.id });
  revalidatePath(`/intern/inventar/item/${item.id}`);
  return { ok: true, attachmentId: ins.id, signed, warning };
}
