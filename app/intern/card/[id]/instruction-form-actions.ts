// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use server";

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  attachments,
  boardInstructionForms,
  cards,
} from "@/lib/db/schema";
import { requireUser } from "@/lib/auth";
import { canAccessBoard, getBoardById } from "@/lib/authz";
import {
  absPath,
  deleteStoredFile,
  saveAntragBuffer,
} from "@/lib/attachments";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import { nextInstructionFilename } from "@/lib/instruction-form";
import { applyEditsAndSign } from "@/lib/pdf-apply";
import { allowRequest } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import type { SavePdfInput, SavePdfResult } from "./pdf-actions";

/**
 * Füllt die aktuell hinterlegte Board-Vorlage und legt das Ergebnis als neuen
 * Kartenanhang ab. Die Vorlage selbst wird nie verändert.
 */
export async function createInstructionPdfAction(
  cardId: number,
  input: SavePdfInput,
): Promise<SavePdfResult> {
  const user = await requireUser();
  if (!Number.isInteger(cardId) || !input || input.attachmentId !== cardId) {
    return { ok: false, error: "Ungültige Eingabe." };
  }
  if (!(await allowRequest(`pdf-save:${user.id}`, 30, 60_000))) {
    return { ok: false, error: "Zu viele Anfragen. Bitte kurz warten." };
  }

  const [card] = await db.select().from(cards).where(eq(cards.id, cardId)).limit(1);
  if (!card) return { ok: false, error: "Karte nicht gefunden." };
  const board = await getBoardById(card.boardId);
  if (!board || !(await canAccessBoard(user, board))) {
    return { ok: false, error: "Kein Zugriff auf dieses Board." };
  }

  const [config] = await db
    .select()
    .from(boardInstructionForms)
    .where(eq(boardInstructionForms.boardId, board.id))
    .limit(1);
  if (!config?.enabled) {
    return { ok: false, error: "Das Anweisungsformular ist nicht mehr aktiviert." };
  }
  if (config.uploadedAt.toISOString() !== input.sourceVersion) {
    return {
      ok: false,
      error: "Die PDF-Vorlage wurde inzwischen ersetzt. Bitte den Editor neu öffnen.",
    };
  }

  let template: Buffer;
  try {
    template = await readFile(absPath(config.path));
  } catch {
    return { ok: false, error: "Die PDF-Vorlage ist nicht mehr lesbar." };
  }

  const result = await applyEditsAndSign(user, input, template);
  if (!result.ok) return result;
  if (result.pdf.length > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "Die ausgefüllte PDF-Datei ist größer als 25 MB und wurde nicht gespeichert.",
    };
  }

  // Dateischreiben bewusst VOR der DB-Sperre; bei einem DB-Fehler wird die
  // neue Datei wieder entfernt. So blockieren langsame I/O-Vorgänge keine Karte.
  const saved = await saveAntragBuffer(
    card.id,
    "Anweisung.pdf",
    result.pdf,
    "application/pdf",
  );

  let attachmentId: number;
  let filename: string;
  try {
    const inserted = await db.transaction(async (tx) => {
      // Serialisiert Erstellungen und normale Uploads auf derselben Karte,
      // damit die sichtbare Nummer auch bei parallelen Klicks eindeutig bleibt.
      const [locked] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.id, card.id))
        .for("update");
      if (!locked) throw new Error("card-missing");

      const [currentTemplate] = await tx
        .select({
          enabled: boardInstructionForms.enabled,
          uploadedAt: boardInstructionForms.uploadedAt,
        })
        .from(boardInstructionForms)
        .where(eq(boardInstructionForms.boardId, board.id))
        .for("update");
      if (
        !currentTemplate?.enabled ||
        currentTemplate.uploadedAt.toISOString() !== input.sourceVersion
      ) {
        throw new Error("instruction-template-changed");
      }

      const existing = await tx
        .select({ filename: attachments.filename })
        .from(attachments)
        .where(eq(attachments.cardId, card.id));
      const nextName = nextInstructionFilename(existing.map((row) => row.filename));
      const [row] = await tx
        .insert(attachments)
        .values({
          cardId: card.id,
          kind: "other",
          uploadPurpose: "instruction",
          filename: nextName,
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
      return { id: row.id, filename: nextName };
    });
    attachmentId = inserted.id;
    filename = inserted.filename;
  } catch (error) {
    await deleteStoredFile(saved.relPath);
    if ((error as Error)?.message === "instruction-template-changed") {
      return {
        ok: false,
        error: "Die PDF-Vorlage wurde inzwischen geändert oder deaktiviert. Bitte den Editor neu öffnen.",
      };
    }
    console.error("[instruction-form] save failed:", error);
    return { ok: false, error: "Die Anweisung konnte nicht gespeichert werden." };
  }

  await logActivity(
    card.id,
    user.id,
    "attachment_added",
    `Anweisung erstellt: ${filename}`,
  );
  revalidatePath(`/intern/card/${card.id}`);
  revalidatePath(`/intern/board/${board.id}`);
  return {
    ok: true,
    attachmentId,
    signed: result.signed,
    warning: result.warning,
  };
}
