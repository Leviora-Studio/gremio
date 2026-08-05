// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use server";

import { revalidatePath } from "next/cache";
import { and, eq, max } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards, attachments, boards, boardStatuses } from "@/lib/db/schema";
import { MAX_PUBLIC_OTHER_FILES, PDF_MIME } from "@/lib/constants";
import {
  nextReceiptIndex,
  receiptFileName,
  saveAntragFile,
  validateUpload,
} from "@/lib/attachments";
import { logActivity } from "@/lib/activity";
import { maybeArchive } from "@/lib/archive";
import { maybeSetTriggerDates } from "@/lib/instruction";
import { doneSinceForStatus } from "@/lib/done-archive";
import { allowFormRequest } from "@/lib/rate-limit";

export type PublicUploadState = { error?: string; success?: string };

/**
 * Antragsteller reicht über den Status-Link eine PDF bei „weitere Dateien" nach.
 * Nur Hinzufügen (append-only) — kein Bearbeiten/Löschen vorhandener Dateien.
 */
export async function addPublicFileAction(
  token: string,
  _prev: PublicUploadState,
  formData: FormData,
): Promise<PublicUploadState> {
  if (!(await allowFormRequest("public-upload"))) {
    return { error: "Zu viele Uploads. Bitte versuche es in einer Minute erneut." };
  }
  const [row] = await db
    .select({ card: cards, isArchiveTrigger: boardStatuses.isArchiveTrigger })
    .from(cards)
    .leftJoin(boardStatuses, eq(boardStatuses.id, cards.statusId))
    .where(eq(cards.token, token))
    .limit(1);
  if (!row?.card) return { error: "Antrag nicht gefunden." };
  const card = row.card;

  // Sperre: Sobald der Antrag in der Archiv-Spalte (Nextcloud-Trigger) liegt,
  // sind die Dateien archiviert — über den öffentlichen Link darf nichts mehr
  // nachgereicht werden (sonst wäre der Nextcloud-Stand unvollständig).
  if (row.isArchiveTrigger) {
    return {
      error:
        "Dieser Antrag ist bereits archiviert. Es können keine weiteren Dateien hinzugefügt werden.",
    };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Bitte eine PDF-Datei auswählen." };
  }
  const err = validateUpload(file, PDF_MIME);
  if (err) return { error: err };

  const existing = await db
    .select({ id: attachments.id, filename: attachments.filename })
    .from(attachments)
    .where(and(eq(attachments.cardId, card.id), eq(attachments.kind, "other")));
  if (existing.length >= MAX_PUBLIC_OTHER_FILES) {
    return { error: "Maximale Anzahl an Dateien erreicht." };
  }

  // Quittungen automatisch fortlaufend benennen: <Antragsnummer>_Q1, _Q2 …
  // Lücken werden wiederverwendet; vorhandene Dateien bleiben unverändert.
  const saved = await saveAntragFile(card.id, file);
  const index = nextReceiptIndex(
    card.number,
    existing.map((e) => e.filename),
  );
  const displayName = receiptFileName(card.number, index, saved.filename);
  await db.insert(attachments).values({
    cardId: card.id,
    kind: "other",
    filename: displayName,
    path: saved.relPath,
    mime: saved.mime,
    size: saved.size,
    uploadedBy: null,
  });
  await db.update(cards).set({ updatedAt: new Date() }).where(eq(cards.id, card.id));
  await logActivity(
    card.id,
    null,
    "attachment_added",
    `Datei nachgereicht (öffentlich): ${displayName}`,
  );

  revalidatePath(`/status/${token}`);
  return { success: "Datei wurde hinzugefügt." };
}

/**
 * Antragsteller klickt auf der Status-Seite „Einreichen". Je nach aktueller
 * Spalte greift eines der beiden board-konfigurierten Gates (autoritativ
 * serverseitig anhand des aktuellen Status bestimmt):
 *  - Gate „Nachreichung": Karte bleibt liegen, wird farblich markiert.
 *  - Gate „Quittung": Karte springt in die Zielspalte (mit Triggern).
 */
export async function submitPublicAction(
  token: string,
  _prev: PublicUploadState,
  _formData: FormData,
): Promise<PublicUploadState> {
  if (!(await allowFormRequest("public-submit"))) {
    return { error: "Zu viele Anfragen. Bitte versuche es in einer Minute erneut." };
  }
  const [card] = await db
    .select()
    .from(cards)
    .where(eq(cards.token, token))
    .limit(1);
  if (!card) return { error: "Antrag nicht gefunden." };
  const [board] = await db
    .select()
    .from(boards)
    .where(eq(boards.id, card.boardId))
    .limit(1);
  if (!board) return { error: "Antrag nicht gefunden." };

  // Archiv-Sperre serverseitig erzwingen (analog addPublicFileAction): liegt die
  // Karte in der Archiv-Trigger-Spalte, ist der Antrag abgeschlossen — kein
  // öffentliches Einreichen mehr, egal was das UI anzeigt.
  const [st] = await db
    .select({ isArchiveTrigger: boardStatuses.isArchiveTrigger })
    .from(boardStatuses)
    .where(eq(boardStatuses.id, card.statusId))
    .limit(1);
  if (st?.isArchiveTrigger) {
    return { error: "Dieser Antrag ist bereits archiviert." };
  }

  // Gate „Nachreichung" — Karte bleibt in der Spalte, nur farbliche Markierung.
  if (board.resubmitStatusId && card.statusId === board.resubmitStatusId) {
    await db
      .update(cards)
      .set({ resubmittedAt: new Date(), updatedAt: new Date() })
      .where(eq(cards.id, card.id));
    await logActivity(
      card.id,
      null,
      "status",
      "Nachreichung eingereicht (öffentlich)",
    );
    revalidatePath(`/status/${token}`);
    revalidatePath(`/intern/board/${board.id}`);
    return {
      success: "Deine Nachreichung wurde eingereicht. Das Gremium wurde informiert.",
    };
  }

  // Gate „Quittung" — Karte in die Zielspalte verschieben (ans Ende), Trigger.
  if (
    board.receiptFromStatusId &&
    board.receiptToStatusId &&
    card.statusId === board.receiptFromStatusId
  ) {
    const target = board.receiptToStatusId;
    const [row] = await db
      .select({ m: max(cards.position) })
      .from(cards)
      .where(and(eq(cards.boardId, board.id), eq(cards.statusId, target)));
    await db
      .update(cards)
      .set({
        statusId: target,
        position: (row?.m ?? -1) + 1,
        resubmittedAt: null,
        // Done-Archiv-Uhr setzen, falls die Zielspalte die Done-Spalte ist.
        doneSince: doneSinceForStatus(board.doneStatusId, target, card.doneSince),
        updatedAt: new Date(),
      })
      .where(eq(cards.id, card.id));
    const [from] = await db
      .select({ name: boardStatuses.name })
      .from(boardStatuses)
      .where(eq(boardStatuses.id, card.statusId))
      .limit(1);
    const [to] = await db
      .select({ name: boardStatuses.name })
      .from(boardStatuses)
      .where(eq(boardStatuses.id, target))
      .limit(1);
    await logActivity(
      card.id,
      null,
      "status",
      `${from?.name ?? "?"} → ${to?.name ?? "?"} (öffentlich eingereicht)`,
    );
    await maybeSetTriggerDates(card.id, target);
    await maybeArchive(card.id);
    revalidatePath(`/status/${token}`);
    revalidatePath(`/intern/board/${board.id}`);
    return { success: "Eingereicht. Vielen Dank!" };
  }

  return { error: "Aktuell ist kein Einreichen möglich." };
}
