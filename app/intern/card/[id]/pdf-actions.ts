// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { readFile } from "node:fs/promises";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { attachments, cardActivity, cards } from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canEditBoard, getBoardById } from "@/lib/authz";
import {
  absPath,
  deleteStoredFile,
  saveAntragBuffer,
} from "@/lib/attachments";
import { allowRequest } from "@/lib/rate-limit";
import { applyEditsAndSign, type EditSignInput } from "@/lib/pdf-apply";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { isCardAttachmentVisible } from "@/lib/card-attachment-visibility";

export type SavePdfInput = {
  attachmentId: number;
  mode: "new" | "replace";
  /** Optionaler Versionsanker für Quellen, die kein normaler Anhang sind. */
  sourceVersion?: string;
} & EditSignInput;

export type SavePdfResult =
  | { ok: true; attachmentId: number; signed: boolean; warning?: string }
  | { ok: false; error: string };

/** Fügt vor der .pdf-Endung ein Suffix ein (z. B. „antrag_signiert.pdf"). */
function withSuffix(filename: string, suffix: string): string {
  const dot = filename.toLowerCase().lastIndexOf(".pdf");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}_${suffix}.pdf`.slice(0, 180);
}

/**
 * Speichert die im Viewer vorgenommenen PDF-Änderungen (Freitext + Formular-
 * felder) und optional eine kryptografische Signatur mit dem Zertifikat des
 * Nutzers. „new" legt eine zusätzliche Datei an (Original bleibt erhalten),
 * „replace" ersetzt den Anhang in-place. Board-Zugriff erforderlich.
 */
export async function savePdfEditsAction(
  input: SavePdfInput,
): Promise<SavePdfResult> {
  const user = await requireUser();
  if (
    !input ||
    !Number.isSafeInteger(input.attachmentId) ||
    input.attachmentId < 1 ||
    input.attachmentId > 2_147_483_647 ||
    (input.mode !== "new" && input.mode !== "replace")
  ) {
    return { ok: false, error: "Ungültige Eingabe." };
  }
  if (!(await allowRequest(`pdf-save:${user.id}`, 30, 60_000))) {
    return { ok: false, error: "Zu viele Anfragen. Bitte kurz warten." };
  }
  const mode = input.mode;

  const [att] = await db
    .select()
    .from(attachments)
    .where(eq(attachments.id, input.attachmentId))
    .limit(1);
  if (!att) return { ok: false, error: "Anhang nicht gefunden." };
  if (att.mime !== "application/pdf") {
    return { ok: false, error: "Nur PDF-Dateien können bearbeitet werden." };
  }

  const [card] = await db
    .select()
    .from(cards)
    .where(eq(cards.id, att.cardId))
    .limit(1);
  if (!card) return { ok: false, error: "Karte nicht gefunden." };
  const board = await getBoardById(card.boardId);
  if (!board || !(await canEditBoard(user, board))) {
    return { ok: false, error: "Kein Zugriff auf dieses Board." };
  }
  const visible = await getVisibleFieldKeys(board.id);
  if (!isCardAttachmentVisible(att, visible)) {
    return { ok: false, error: "Dieses Dateifeld ist auf dem Board nicht aktiviert." };
  }
  if (mode === "new" && !visible.has("other_pdfs")) {
    return {
      ok: false,
      error: "Das Feld für weitere PDF-Dateien ist auf dem Board nicht aktiviert.",
    };
  }

  let pdf: Buffer;
  try {
    pdf = await readFile(absPath(att.path));
  } catch {
    return { ok: false, error: "Originaldatei nicht lesbar." };
  }

  // Gemeinsamer Kern mit Inventar und Anweisungsvorlage (Bearbeiten + Signieren).
  const result = await applyEditsAndSign(user, input, pdf);
  if (!result.ok) return result;
  const { signed, warning } = result;
  pdf = result.pdf;
  if (pdf.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "Die bearbeitete PDF-Datei ist größer als 25 MB und wurde nicht gespeichert.",
    };
  }

  const noun = signed ? "signiert" : "bearbeitet";

  if (mode === "replace") {
    const saved = await saveAntragBuffer(card.id, att.filename, pdf, "application/pdf");
    const oldPath = att.path;
    try {
      await db.transaction(async (tx) => {
        const [lockedCard] = await tx
          .select({ id: cards.id })
          .from(cards)
          .where(eq(cards.id, card.id))
          .for("update");
        const [current] = await tx
          .select({ path: attachments.path, folderId: attachments.folderId })
          .from(attachments)
          .where(
            and(
              eq(attachments.id, att.id),
              eq(attachments.cardId, card.id),
            ),
          )
          .for("update");
        if (!lockedCard || !current || current.path !== oldPath) {
          throw new Error("attachment-changed");
        }
        await tx
          .update(attachments)
          .set({
            path: saved.relPath,
            size: saved.size,
            mime: "application/pdf",
            uploadedAt: new Date(),
            uploadedBy: user.id,
          })
          .where(eq(attachments.id, att.id));
        await tx
          .update(cards)
          .set({ updatedAt: new Date() })
          .where(eq(cards.id, card.id));
        await tx.insert(cardActivity).values({
          cardId: card.id,
          userId: user.id,
          type: "attachment_added",
          detail: `PDF ${noun} (ersetzt): ${att.filename}`,
        });
      });
    } catch (error) {
      await deleteStoredFile(saved.relPath);
      if ((error as Error)?.message === "attachment-changed") {
        return {
          ok: false,
          error: "Die PDF-Datei wurde inzwischen geändert oder gelöscht. Bitte neu öffnen.",
        };
      }
      console.error("[pdf-edit] replace failed:", error);
      return { ok: false, error: "Die PDF-Datei konnte nicht gespeichert werden." };
    }
    await deleteStoredFile(oldPath);
    revalidatePath(`/intern/card/${card.id}`);
    return { ok: true, attachmentId: att.id, signed, warning };
  }

  const newName = withSuffix(att.filename, noun);
  const saved = await saveAntragBuffer(card.id, newName, pdf, "application/pdf");
  let attachmentId: number;
  try {
    attachmentId = await db.transaction(async (tx) => {
      const [lockedCard] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.id, card.id))
        .for("update");
      const [current] = await tx
        .select({ path: attachments.path, folderId: attachments.folderId })
        .from(attachments)
        .where(
          and(eq(attachments.id, att.id), eq(attachments.cardId, card.id)),
        )
        .for("update");
      if (!lockedCard || !current || current.path !== att.path) {
        throw new Error("attachment-changed");
      }
      const [inserted] = await tx
        .insert(attachments)
        .values({
          cardId: card.id,
          kind: "other",
          filename: newName,
          folderId: current.folderId,
          path: saved.relPath,
          mime: "application/pdf",
          size: saved.size,
          uploadedBy: user.id,
        })
        .returning({ id: attachments.id });
      await tx
        .update(cards)
        .set({ updatedAt: new Date() })
        .where(eq(cards.id, card.id));
      await tx.insert(cardActivity).values({
        cardId: card.id,
        userId: user.id,
        type: "attachment_added",
        detail: `PDF ${noun} (neue Datei): ${newName}`,
      });
      return inserted.id;
    });
  } catch (error) {
    await deleteStoredFile(saved.relPath);
    if ((error as Error)?.message === "attachment-changed") {
      return {
        ok: false,
        error: "Die PDF-Datei wurde inzwischen geändert oder gelöscht. Bitte neu öffnen.",
      };
    }
    console.error("[pdf-edit] create copy failed:", error);
    return { ok: false, error: "Die PDF-Kopie konnte nicht gespeichert werden." };
  }
  revalidatePath(`/intern/card/${card.id}`);
  return { ok: true, attachmentId, signed, warning };
}
